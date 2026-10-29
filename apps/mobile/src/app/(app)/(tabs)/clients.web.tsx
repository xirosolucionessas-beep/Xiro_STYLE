/**
 * Ruta /clients SOLO WEB (nativo: clients.tsx). Mismos datos y acciones que la nativa (búsqueda en el servidor, alta y
 * ficha de cliente). El directorio se pagina por cursor ("Cargar más"); los indicadores salen de `/clients/summary` y
 * las columnas de servicios de `/service-records/by-client` (solo de las filas visibles). La presentación está en
 * src/web/screens/Clients.tsx.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { actorOf, meets } from '@/lib/access';
import { dayRange, todayIn } from '@/lib/agenda';
import { errorKey } from '@/lib/api';
import { flatPages, useClientVisits, useClientsPages, useClientsSummary } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { Ico } from '@/web/icons';
import { ClientsView, type ClientRowView } from '@/web/screens/Clients';
import { useWebText } from '@/web/services/useWebText';
import { Button } from '@/web/ui/Button';
import type { KpiView } from '@/web/ui/Page';

export default function ClientsWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { user, business } = useAuthed();
  const actor = actorOf(user);
  const canRecords = meets(actor, ['services_record']);
  const canManage = meets(actor, ['clients_manage']);
  // Llegada desde la tarjeta "Clientes nuevos hoy" del tablero de Inicio: se acota a los de hoy hasta que se quite el filtro.
  const params = useLocalSearchParams<{ since?: string }>();
  const sinceToday = params.since === 'today';
  const todayKey = todayIn(business.timezone);

  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setApplied(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // "Clientes nuevos hoy" (desde el Inicio): el servidor filtra por fecha de alta en el día del negocio.
  const today = useMemo(() => (sinceToday ? dayRange(todayKey, business.timezone, 1) : null), [sinceToday, todayKey, business.timezone]);
  const clients = useClientsPages({ q: applied || undefined, createdFrom: today?.from, createdTo: today?.to });
  const summary = useClientsSummary();
  const loaded = useMemo(() => flatPages(clients.data), [clients.data]);
  const visits = useClientVisits(
    loaded.map((c) => c.id),
    canRecords,
  );

  const date = useMemo(() => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: business.timezone }), [language, business.timezone]);
  const rows = useMemo<ClientRowView[]>(() => {
    const byClient = new Map((visits.data ?? []).map((v) => [v.clientId, v]));
    return loaded.map((client) => {
      const stats = canRecords && visits.data ? byClient.get(client.id) : undefined;
      return {
        id: client.id,
        name: client.name,
        phone: client.phone,
        email: client.email,
        photoUrl: client.photoUrl,
        since: date.format(new Date(client.createdAt)),
        // Sin permiso o mientras cargan: "—"; cargadas y sin servicios: "0".
        visits: canRecords && visits.data ? String(stats?.count ?? 0) : null,
        lastVisit: stats?.lastAt ? date.format(new Date(stats.lastAt)) : null,
        href: `/client/${client.id}`,
      };
    });
  }, [loaded, visits.data, canRecords, date]);

  const kpis: KpiView[] = [
    { id: 'total', icon: 'users', label: t('sec_kpi_clients_total'), value: summary.data ? String(summary.data.total) : '—', loading: summary.isLoading },
    { id: 'month', icon: 'plus', label: t('sec_kpi_new_month'), value: summary.data ? String(summary.data.newThisMonth) : '—', loading: summary.isLoading },
    ...(canRecords ? [{ id: 'active', icon: 'activity' as const, label: t('sec_kpi_active'), value: summary.data ? String(summary.data.active30d) : '—', loading: summary.isLoading }] : []),
  ];

  const addClient = () => router.push('/client/form');
  const state = clients.isPending ? 'loading' : clients.isError ? 'error' : 'ready';

  return (
    <Screen
      header={
        <Header
          root
          title={sinceToday ? t('sec_clients_new_today') : t('clients')}
          subtitle={t('sec_clients_sub')}
          right={
            <>
              {sinceToday ? (
                <Button variant="secondary" onPress={() => router.push('/clients')}>
                  {t('sec_clients_see_all')}
                </Button>
              ) : null}
              {canManage ? (
                <Button icon={<Ico name="plus" size={18} />} onPress={addClient}>
                  {t('add')}
                </Button>
              ) : null}
            </>
          }
        />
      }>
      <ClientsView
        t={t}
        kpis={kpis}
        search={search}
        onSearch={setSearch}
        appliedQuery={applied}
        rows={rows}
        showServiceCols={canRecords}
        state={state}
        errorMessage={clients.isError ? t(errorKey(clients.error)) : undefined}
        onRetry={() => void clients.refetch()}
        pagination={{
          hasMore: Boolean(clients.hasNextPage),
          loading: clients.isFetchingNextPage,
          error: clients.isFetchNextPageError ? t(errorKey(clients.error)) : undefined,
          onLoadMore: () => void clients.fetchNextPage(),
        }}
        emptyAction={
          canManage ? (
            <Button icon={<Ico name="plus" size={18} />} onPress={addClient}>
              {t('client_new')}
            </Button>
          ) : undefined
        }
        navigate={(href) => router.push(href as never)}
      />
    </Screen>
  );
}
