import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { errorKey } from '@/lib/api';
import { useClients } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Card, EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';

export default function Clients() {
  const router = useRouter();
  const { colors, t } = useSettings();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const clients = useClients(debounced);

  return (
    <Screen
      refreshing={clients.isRefetching}
      onRefresh={() => void clients.refetch()}
      header={<Header root title={t('clients')} right={<Button label={t('add')} icon="add" compact onPress={() => router.push('/client/form')} />} />}>
      <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('search')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('search')}
          autoCapitalize="none"
          style={[styles.input, { color: colors.text }]}
        />
      </View>

      {clients.isPending ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
      ) : clients.isError ? (
        <AppText tone="danger" center style={{ marginTop: 24 }}>
          {t(errorKey(clients.error))}
        </AppText>
      ) : clients.data.length === 0 ? (
        <EmptyState icon="people-outline" message={t('no_clients')} />
      ) : (
        <View style={{ gap: 10, marginTop: 14 }}>
          {clients.data.map((client) => (
            <Card key={client.id} onPress={() => router.push({ pathname: '/client/[id]', params: { id: client.id } })} style={styles.clientCard}>
              <View style={[styles.avatar, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
                <AppText variant="heading" tone="gold">
                  {client.name.trim().charAt(0).toUpperCase()}
                </AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {client.name}
                </AppText>
                <AppText variant="small" tone="muted" numberOfLines={1}>
                  {client.phone ?? client.email ?? '—'}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 46 },
  input: { flex: 1, fontSize: 15, paddingVertical: 8, outlineStyle: 'none' } as never,
  clientCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
