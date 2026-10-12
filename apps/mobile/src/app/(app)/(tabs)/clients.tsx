import { Ionicons } from '@expo/vector-icons';
import type { Client } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { errorKey } from '@/lib/api';
import { clientsPagesKey, flatPages, refreshFromStart, useClientsPages, useClientsSummary } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Card, EmptyState, Photo } from '@/ui/Kit';
import { PagedFooter } from '@/ui/PagedFooter';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';

/**
 * Clientes en Android/iOS (en la Web: clients.web.tsx). Mismos indicadores que la web (total, nuevos este mes y, con
 * permiso de registrar servicios, activos en 30 días) — calculados en el servidor (\`/clients/summary\`), sin descargar
 * el directorio. La lista es una FlatList paginada por cursor (50 por página, búsqueda en el servidor) que carga la
 * siguiente página al acercarse al final: fluida con miles de clientes. Alta solo con permiso de gestionar.
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
  const { user } = useAuthed();
  const actor = actorOf(user);
  const canManage = meets(actor, ['clients_manage']);
  const canRecords = meets(actor, ['services_record']);
  const queryClient = useQueryClient();
  const params = { q: debounced || undefined };
  const clients = useClientsPages(params);
  const summary = useClientsSummary();
  const rows = useMemo(() => flatPages(clients.data), [clients.data]);

  const kpis = [
    { id: 'total', label: t('sec_kpi_clients_total'), value: summary.data ? String(summary.data.total) : '—' },
    { id: 'month', label: t('sec_kpi_new_month'), value: summary.data ? String(summary.data.newThisMonth) : '—' },
    ...(canRecords ? [{ id: 'active', label: t('sec_kpi_active'), value: summary.data ? String(summary.data.active30d) : '—' }] : []),
  ];

  const loadMore = useCallback(() => {
    if (clients.hasNextPage && !clients.isFetchingNextPage && !clients.isFetchNextPageError) void clients.fetchNextPage();
  }, [clients]);
  // Desde la primera página: volver a pedir todas las ya cargadas serían decenas de peticiones en serie con miles de clientes.
  const refresh = () => void Promise.all([refreshFromStart(queryClient, clientsPagesKey(params)), summary.refetch()]);

  const renderClient = useCallback(
    ({ item: client }: { item: Client }) => (
      <Card onPress={() => router.push({ pathname: '/client/[id]', params: { id: client.id } })} style={styles.clientCard}>
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
    ),
    [colors, router],
  );

  const listHeader = (
    <View>
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
    </View>
  );

  return (
    <Screen scroll={false} header={<Header root title={t('clients')} right={canManage ? <Button label={t('add')} icon="add" compact onPress={() => router.push('/client/form')} /> : undefined} />}>
      <FlatList
        data={rows}
        keyExtractor={(client) => client.id}
        renderItem={renderClient}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          clients.isPending ? (
            <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
          ) : clients.isError ? (
            <View style={styles.errorBox}>
              <AppText tone="danger" center>
                {t(errorKey(clients.error))}
              </AppText>
              <Button label={t('retry')} variant="secondary" compact onPress={() => void clients.refetch()} />
            </View>
          ) : (
            <EmptyState icon="people-outline" message={t('no_clients')} />
          )
        }
        ListFooterComponent={rows.length > 0 ? <PagedFooter loading={clients.isFetchingNextPage} error={clients.isFetchNextPageError ? clients.error : null} onRetry={() => void clients.fetchNextPage()} /> : null}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ItemSeparatorComponent={Separator}
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        windowSize={11}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={clients.isRefetching && !clients.isFetchingNextPage} onRefresh={refresh} tintColor={colors.gold} />}
      />
    </Screen>
  );
}

const Separator = () => <View style={{ height: 10 }} />;

const styles = StyleSheet.create({
  kpis: { flexDirection: 'row', gap: 8, marginBottom: 14, marginTop: 4 },
  kpi: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: 10, gap: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 46, marginBottom: 14 },
  input: { flex: 1, fontSize: 15, paddingVertical: 8, outlineStyle: 'none' } as never,
  clientCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  errorBox: { alignItems: 'center', gap: 12, marginTop: 24 },
  listContent: { paddingBottom: 32 },
});
