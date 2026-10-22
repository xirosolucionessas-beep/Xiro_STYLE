import { Ionicons } from '@expo/vector-icons';
import { assistantAnswerText, assistantGreeting, translate, type AssistantQuestionKey, type ReportPeriod } from '@xiro/shared';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StatusBar, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '@/lib/api';
import { askAssistant, type AssistantAskResult, type AssistantRequest } from '@/lib/assistant';
import { pickFromLibrary, takePhotoResult, uploadableImage, type PickedImage } from '@/lib/images';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { radius } from '../theme';
import { AssistantCatalog } from './AssistantCatalog';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Foto de un producto adjunta a ESTE mensaje (comparada contra el inventario — ver lib/assistant.ts). */
  imageUri?: string;
}

let nextId = 0;
/** Aire bajo la barra de estado para que el encabezado del chat nunca quede pegado ni debajo de ella. */
const TOP_GAP = 10;
const uid = () => `m${(nextId += 1)}`;

/**
 * Chat del asistente de negocio a pantalla completa (Android/iOS). Misma conducta que el panel web: saludo inicial,
 * burbujas por rol, indicador "Escribiendo…" mientras espera y, sin backend, el aviso honesto de "no disponible".
 * La conversación vive solo en memoria mientras la app está abierta; nada se guarda en el teléfono.
 */
export function AssistantChat({ open, onClose, ask = askAssistant }: { open: boolean; onClose: () => void; ask?: (request: AssistantRequest) => Promise<AssistantAskResult> }) {
  const { t, colors, language } = useSettings();
  const { business } = useSession();
  const insets = useSafeAreaInsets();
  // El modal es translúcido bajo la barra de estado: si en Android la zona segura llega en 0, se usa la altura real de la barra.
  const statusTop = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<PickedImage | null>(null);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const list = useRef<FlatList<Message>>(null);

  useEffect(() => {
    if (messages.length > 0) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
  }, [messages.length, sending]);

  const replyFor = (result: AssistantAskResult): string =>
    result.ok
      ? result.reply
      : result.reason === 'unavailable'
        ? t('ai_unavailable')
        : result.reason === 'not_understood'
          ? t('assistant_not_understood')
          : result.reason === 'ambiguous'
            ? `${t('assistant_ambiguous')} ${result.candidates.map((q) => t(`assistant_q_${q}`)).join(' / ')}`
            : result.reason === 'no_access'
              ? t('assistant_catalog_no_access')
              : t('ai_error_general');

  /* ---------- Foto de un producto (comparada contra el inventario — ver lib/assistant.ts) ---------- */
  const chooseFromGallery = async () => {
    setAttachError(undefined);
    try {
      const [picked] = await pickFromLibrary(1);
      if (picked) setPendingImage(picked);
    } catch {
      setAttachError(t('reg_gallery_denied'));
    }
  };
  const takePhoto = async () => {
    setAttachError(undefined);
    try {
      const result = await takePhotoResult();
      if (result.status === 'ok') setPendingImage(result.image);
      else if (result.status === 'denied') setAttachError(t('reg_camera_denied'));
    } catch {
      setAttachError(t('reg_camera_denied'));
    }
  };

  const send = async () => {
    const text = draft.trim();
    const image = pendingImage;
    if ((!text && !image) || sending) return;
    setDraft('');
    setPendingImage(null);
    setMessages((current) => [...current, { id: uid(), role: 'user', text, imageUri: image?.uri }]);
    setSending(true);
    const imageForm = image ? await uploadableImage(image) : undefined;
    const result = await ask({ text, language, imageForm }).catch((): AssistantAskResult => ({ ok: false, reason: 'network' }));
    setSending(false);
    setMessages((current) => [...current, { id: uid(), role: 'assistant', text: replyFor(result) }]);
  };

  /** Desde el catálogo ("Ver todas las preguntas"): la pregunta ya es conocida, no hace falta reconocerla en el texto. */
  const runQuestion = async (question: AssistantQuestionKey, period?: ReportPeriod) => {
    setCatalogOpen(false);
    setMessages((current) => [...current, { id: uid(), role: 'user', text: t(`assistant_q_${question}`) }]);
    setSending(true);
    try {
      const answer = await api.assistantAsk({ question, period });
      const reply = assistantAnswerText(answer, (key) => translate(language, key));
      setMessages((current) => [...current, { id: uid(), role: 'assistant', text: reply }]);
    } catch (error) {
      const reply = error instanceof ApiError && error.status === 403 ? t('assistant_catalog_no_access') : t('ai_error_general');
      setMessages((current) => [...current, { id: uid(), role: 'assistant', text: reply }]);
    } finally {
      setSending(false);
    }
  };

  const canSend = !sending && (draft.trim() !== '' || pendingImage !== null);
  const welcome: Message = { id: 'welcome', role: 'assistant', text: assistantGreeting(new Date().getHours(), business?.name, t) };

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen">
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: statusTop + TOP_GAP }]} accessibilityViewIsModal>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
            <Ionicons name="sparkles" size={20} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="heading" accessibilityRole="header">
              {t('ai_title')}
            </AppText>
            <AppText variant="small" tone="muted">
              {t('ai_subtitle')}
            </AppText>
          </View>
          {!catalogOpen ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('assistant_see_all')} onPress={() => setCatalogOpen(true)} hitSlop={8} style={[styles.close, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="list" size={20} color={colors.text} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={t('ai_close')} onPress={onClose} hitSlop={8} style={[styles.close, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>

        {catalogOpen ? (
          <AssistantCatalog onPick={(question, period) => void runQuestion(question, period)} onClose={() => setCatalogOpen(false)} />
        ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            ref={list}
            data={[welcome, ...messages]}
            keyExtractor={(message) => message.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const mine = item.role === 'user';
              const spokenText = item.text || (item.imageUri ? t('assistant_photo') : '');
              return (
                <View style={[styles.bubbleRow, mine ? styles.mineRow : null]} accessible accessibilityLabel={`${mine ? t('ai_you') : t('ai_bot')}: ${spokenText}`}>
                  <View style={[styles.bubble, mine ? [styles.mine, { backgroundColor: colors.gold }] : [styles.theirs, { backgroundColor: colors.surface, borderColor: colors.border }]]}>
                    {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.msgImage} accessibilityIgnoresInvertColors /> : null}
                    {item.text ? <AppText tone={mine ? 'onGold' : 'text'}>{item.text}</AppText> : null}
                  </View>
                </View>
              );
            }}
            ListFooterComponent={
              sending ? (
                <View style={styles.typing} accessibilityLiveRegion="polite">
                  <ActivityIndicator size="small" color={colors.gold} />
                  <AppText variant="small" tone="muted">
                    {t('ai_typing')}
                  </AppText>
                </View>
              ) : null
            }
          />

          <AppText variant="small" tone="muted" center style={styles.footer}>
            {t('ai_footer')}
          </AppText>

          {pendingImage ? (
            <View style={styles.attachRow}>
              <View style={styles.attachThumbWrap}>
                <Image source={{ uri: pendingImage.uri }} style={styles.attachThumb} accessible accessibilityLabel={t('assistant_photo_pending')} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('assistant_remove_image')}
                  hitSlop={8}
                  onPress={() => setPendingImage(null)}
                  style={[styles.attachRemove, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Ionicons name="close" size={14} color={colors.text} />
                </Pressable>
              </View>
            </View>
          ) : null}
          {attachError ? (
            <AppText variant="small" tone="danger" style={styles.attachError} accessibilityRole="alert">
              {attachError}
            </AppText>
          ) : null}

          <View style={[styles.composer, { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('assistant_attach_image')} onPress={() => void chooseFromGallery()} hitSlop={8} style={[styles.sqBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="image" size={18} color={colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('assistant_take_photo')} onPress={() => void takePhoto()} hitSlop={8} style={[styles.sqBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="camera" size={18} color={colors.text} />
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('ai_placeholder')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('ai_placeholder')}
              multiline
              maxLength={2000}
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('ai_send')}
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={() => void send()}
              style={[styles.send, { backgroundColor: canSend ? colors.gold : colors.surfaceAlt }]}>
              <Ionicons name="arrow-up" size={22} color={canSend ? colors.onGold : colors.textMuted} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  close: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10 },
  bubbleRow: { flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg },
  mine: { borderBottomRightRadius: 6 },
  theirs: { borderWidth: 1, borderBottomLeftRadius: 6 },
  msgImage: { width: 180, height: 180, borderRadius: radius.md, marginBottom: 6 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  sqBtn: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 46, maxHeight: 130, borderWidth: 1, borderRadius: 23, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 15 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: 16, paddingBottom: 8 },
  attachRow: { paddingHorizontal: 16, paddingBottom: 8 },
  attachThumbWrap: { width: 72, height: 72 },
  attachThumb: { width: 72, height: 72, borderRadius: radius.md },
  attachRemove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  attachError: { paddingHorizontal: 16, paddingBottom: 8 },
});
