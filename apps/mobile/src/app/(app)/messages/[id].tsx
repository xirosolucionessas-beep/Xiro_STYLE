import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { relativeTime } from '@/lib/alerts';
import { api, errorKey } from '@/lib/api';
import { useConversationMessages, useConversations, useInvalidateMessages } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

/** Un chat 1 a 1 con alguien del equipo: mensajes en orden, más reciente abajo, y una caja para responder. */
export default function MessageThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language, colors } = useSettings();
  const { user } = useAuthed();
  const conversations = useConversations();
  const thread = useConversationMessages(id ?? null);
  const invalidate = useInvalidateMessages();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const peer = conversations.data?.find((c) => c.id === id)?.peer;

  useEffect(() => {
    if (id) void api.markConversationRead(id).then(() => invalidate(id));
  }, [id]);

  async function send() {
    const content = text.trim();
    if (!content || !id) return;
    setSending(true);
    setError(undefined);
    try {
      await api.sendMessage(id, content);
      setText('');
      await invalidate(id);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen
      header={<Header title={peer?.name ?? t('messages_title')} />}
      footer={
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label={t('msg_input_placeholder')} value={text} onChangeText={setText} multiline maxLength={4000} />
          </View>
          <Button label={t('msg_send')} icon="send-outline" onPress={() => void send()} loading={sending} disabled={!text.trim()} />
        </View>
      }>
      {error ? (
        <AppText tone="danger" style={{ marginBottom: 10 }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      {thread.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('dash_loading')} /> : null}
      {thread.isError ? <AppText tone="danger">{t('msg_load_error')}</AppText> : null}
      {!thread.isLoading && (thread.data ?? []).length === 0 ? <EmptyState icon="chatbubble-outline" message={t('msg_thread_empty')} /> : null}
      <View style={{ gap: 8 }}>
        {(thread.data ?? []).map((m) => {
          const mine = m.senderId === user.id;
          return (
            <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%', backgroundColor: mine ? colors.gold : colors.surfaceAlt, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
              <AppText style={{ color: mine ? colors.onGold : colors.text }}>{m.content}</AppText>
              <AppText variant="small" style={{ color: mine ? colors.onGold : colors.textMuted, opacity: 0.8, marginTop: 2 }}>
                {relativeTime(Date.parse(m.createdAt), Date.now(), language)}
              </AppText>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}
