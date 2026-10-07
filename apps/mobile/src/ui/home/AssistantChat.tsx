import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StatusBar, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAssistant, type AssistantAskResult, type AssistantRequest } from '@/lib/assistant';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { radius } from '../theme';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
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
  const { t, colors } = useSettings();
  const insets = useSafeAreaInsets();
  // El modal es translúcido bajo la barra de estado: si en Android la zona segura llega en 0, se usa la altura real de la barra.
  const statusTop = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList<Message>>(null);

  useEffect(() => {
    if (messages.length > 0) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
  }, [messages.length, sending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setMessages((current) => [...current, { id: uid(), role: 'user', text }]);
    setSending(true);
    const result = await ask({ text }).catch((): AssistantAskResult => ({ ok: false, reason: 'network' }));
    setSending(false);
    const reply = result.ok ? result.reply : result.reason === 'unavailable' ? t('ai_unavailable') : t('ai_error_general');
    setMessages((current) => [...current, { id: uid(), role: 'assistant', text: reply }]);
  };

  const canSend = !sending && draft.trim() !== '';
  const welcome: Message = { id: 'welcome', role: 'assistant', text: t('ai_welcome') };

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
          <Pressable accessibilityRole="button" accessibilityLabel={t('ai_close')} onPress={onClose} hitSlop={8} style={[styles.close, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            ref={list}
            data={[welcome, ...messages]}
            keyExtractor={(message) => message.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const mine = item.role === 'user';
              return (
                <View style={[styles.bubbleRow, mine ? styles.mineRow : null]} accessible accessibilityLabel={`${mine ? t('ai_you') : t('ai_bot')}: ${item.text}`}>
                  <View style={[styles.bubble, mine ? [styles.mine, { backgroundColor: colors.gold }] : [styles.theirs, { backgroundColor: colors.surface, borderColor: colors.border }]]}>
                    <AppText tone={mine ? 'onGold' : 'text'}>{item.text}</AppText>
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
          <View style={[styles.composer, { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
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
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 46, maxHeight: 130, borderWidth: 1, borderRadius: 23, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 15 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: 16, paddingBottom: 8 },
});
