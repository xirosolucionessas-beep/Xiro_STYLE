import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { relativeTime } from '@/lib/alerts';
import { api } from '@/lib/api';
import { useConversations, useInvalidateMessages, useMessagePeople } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Card, EmptyState, Photo } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

/**
 * Chat interno del equipo: conversaciones con el dueño y con cada empleado del negocio. Tocar el "+" muestra a quién
 * escribirle; tocar una conversación abre su hilo (messages/[id].tsx). Nunca con un cliente (no inicia sesión: para eso
 * ya está WhatsApp).
 */
export default function Messages() {
  const router = useRouter();
  const { t, language, colors } = useSettings();
  const { user } = useAuthed();
  const conversations = useConversations();
  const people = useMessagePeople();
  const invalidate = useInvalidateMessages();
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);

  const peopleWithoutChat = (people.data ?? []).filter((p) => !(conversations.data ?? []).some((c) => c.peer.id === p.id));

  async function start(userId: string) {
    setStarting(true);
    try {
      const conversation = await api.startConversation(userId);
      await invalidate();
      setPicking(false);
      router.push({ pathname: '/messages/[id]', params: { id: conversation.id } });
    } finally {
      setStarting(false);
    }
  }

  return (
    <Screen header={<Header title={t('messages_title')} root right={<Button label={picking ? t('close') : t('msg_new')} icon={picking ? 'close' : 'add'} compact variant={picking ? 'secondary' : 'primary'} onPress={() => setPicking((v) => !v)} />} />}>
      {picking ? (
        <Card style={{ marginBottom: 12 }}>
          <AppText variant="small" tone="muted" style={{ marginBottom: 8 }}>
            {t('msg_pick_person')}
          </AppText>
          {people.isLoading ? <ActivityIndicator /> : null}
          {!people.isLoading && (people.data ?? []).length === 0 ? <AppText variant="small">{t('msg_no_people')}</AppText> : null}
          <View style={{ gap: 4 }}>
            {peopleWithoutChat.map((p) => (
              <Pressable key={p.id} accessibilityRole="button" disabled={starting} onPress={() => void start(p.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
                <Photo url={p.photoUrl} size={40} icon="person-outline" />
                <AppText variant="bodyStrong">{p.name}</AppText>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {conversations.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('dash_loading')} /> : null}
      {!conversations.isLoading && (conversations.data ?? []).length === 0 ? <EmptyState icon="chatbubbles-outline" message={t('msg_list_empty_title')} /> : null}

      <View style={{ gap: 10 }}>
        {(conversations.data ?? []).map((c) => (
          <Card key={c.id} onPress={() => router.push({ pathname: '/messages/[id]', params: { id: c.id } })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Photo url={c.peer.photoUrl} size={48} icon="person-outline" />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{c.peer.name}</AppText>
                {c.lastMessage ? (
                  <AppText variant="small" tone="muted" numberOfLines={1}>
                    {c.lastMessage.senderId === user.id ? t('msg_you_prefix', { text: c.lastMessage.content }) : c.lastMessage.content}
                  </AppText>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <AppText variant="small" tone="muted">
                  {relativeTime(Date.parse(c.updatedAt), Date.now(), language)}
                </AppText>
                {c.unreadCount > 0 ? (
                  <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold }}>
                    <AppText variant="small" style={{ color: colors.onGold, fontWeight: '800' }}>
                      {c.unreadCount > 9 ? '9+' : c.unreadCount}
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
