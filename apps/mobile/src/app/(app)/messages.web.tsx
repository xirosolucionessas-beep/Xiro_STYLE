/**
 * Ruta /messages SOLO WEB (nativo: messages.tsx + messages/[id].tsx, con su propia navegación). Lista y hilo en una sola
 * pantalla (columna izquierda/derecha en ancho, una vista a la vez en angosto). Abrir la campanita de mensajes o tocar
 * una fila lleva aquí con `?c=<id>` ya seleccionado; la conversación abierta SIEMPRE vive en ese parámetro (no en un
 * estado aparte), así que "Volver" y elegir otro chat son solo cambios de URL. Presentación en src/web/screens/Messages.tsx.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { relativeTime } from '@/lib/alerts';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useConversationMessages, useConversations, useInvalidateMessages, useMessagePeople } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { MessagesView } from '@/web/screens/Messages';
import { useNow } from '@/web/services/useNow';
import { useWebText } from '@/web/services/useWebText';

export default function MessagesWeb() {
  const router = useRouter();
  const params = useLocalSearchParams<{ c?: string }>();
  const { t, language } = useWebText();
  const { user } = useAuthed();
  const now = useNow();
  const selectedId = params.c ?? null;
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();

  const people = useMessagePeople();
  const conversations = useConversations();
  const thread = useConversationMessages(selectedId);
  const invalidate = useInvalidateMessages();

  // Al abrir un chat, lo que la otra persona escribió queda leído (mismo criterio que abrir cualquier bandeja).
  useEffect(() => {
    if (selectedId) void api.markConversationRead(selectedId).then(() => invalidate(selectedId));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(userId: string) {
    const conversation = await api.startConversation(userId);
    await invalidate();
    router.setParams({ c: conversation.id });
  }

  async function send(content: string) {
    if (!selectedId) return;
    setSending(true);
    setSendError(undefined);
    try {
      await api.sendMessage(selectedId, content);
      await invalidate(selectedId);
    } catch (error) {
      setSendError(apiErrors(error, t).general ?? t('msg_send_error'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen header={<Header title={t('messages_title')} />}>
      <MessagesView
        t={t}
        meId={user.id}
        people={people.data ?? []}
        peopleLoading={people.isLoading}
        conversations={conversations.data ?? []}
        conversationsLoading={conversations.isLoading}
        timeOf={(iso) => relativeTime(Date.parse(iso), now, language)}
        selectedId={selectedId}
        onSelect={(id) => router.setParams({ c: id })}
        onBack={() => router.replace('/messages')}
        onStart={(userId) => void start(userId)}
        thread={thread.data ?? []}
        threadLoading={thread.isLoading}
        threadError={thread.isError}
        onSend={(content) => void send(content)}
        sending={sending}
        sendError={sendError}
      />
    </Screen>
  );
}
