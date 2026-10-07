import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { errorKey } from '@/lib/api';
import { useClients, useServiceRecords } from '@/lib/queries';
import { activeClients, newThisMonth } from '@/lib/sections';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Card, EmptyState, Photo } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';

/**
 * Clientes en Android/iOS (en la Web: clients.web.tsx). Mismos indicadores que la web (total, nuevos este mes y, con
 * permiso de registrar servicios, activos en 30 días), búsqueda en el servidor y alta solo con permiso de gestionar.
 */
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
  const { user, business } = useAuthed();
  const actor = actorOf(user);
  const canManage = meets(actor, ['clients_manage']);
  const canRecords = meets(actor, ['services_record']);
  const everyone = useClients('');
  const records = useServiceRecords(undefined, canRecords);
  const kpis = useMemo(() => {
    const now = new Date();
    return [
      { id: 'total', label: t('sec_kpi_clients_total'), value: everyone.data ? String(everyone.data.length) : '—' },
      { id: 'month', label: t('sec_kpi_new_month'), value: everyone.data ? String(newThisMonth(everyone.data, business.timezone, now)) : '—' },
      ...(canRecords ? [{ id: 'active', label: t('sec_kpi_active'), value: records.data ? String(activeClients(records.data, 30, now)) : '—' }] : []),
    ];
  }, [everyone.data, records.data, canRecords, business.timezone, t]);

  return (
    <Screen
      refreshing={clients.isRefetching}
      onRefresh={() => void Promise.all([clients.refetch(), everyone.refetch(), canRecords ? records.refetch() : undefined])}
      header={<Header root title={t('clients')} right={canManage ? <Button label={t('add')} icon="add" compact onPress={() => router.push('/client/form')} /> : undefined} />}>
      <View style={styles.kpis}>
        {kpis.map((kpi) => (
          <View key={kpi.id} style={[styles.kpi, { backgroundColor: colors.surface, borderColor: colors.border }]} accessible accessibilityLabel={`${kpi.label}: ${kpi.value}`}>
            <AppText variant="heading" numberOfLines={1}>
              {kpi.value}
            </AppText>
            <AppText variant="small" tone="muted" numberOfLines={2}>
              {kpi.label}
            </AppText>
          </View>
        ))}
      </View>

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
              <Photo url={client.photoUrl} size={44} style={[styles.avatar, { backgroundColor: colors.goldTint, borderColor: colors.gold }]} initials={client.name} icon="person-outline" />
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
  kpis: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kpi: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: 10, gap: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 46 },
  input: { flex: 1, fontSize: 15, paddingVertical: 8, outlineStyle: 'none' } as never,
  clientCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
