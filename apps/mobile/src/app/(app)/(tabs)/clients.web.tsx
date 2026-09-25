/**
 * Ruta /clients SOLO WEB (nativo: clients.tsx, sin cambios). Mismos datos y acciones que la nativa (búsqueda en el
 * servidor, alta y ficha de cliente); la presentación está en src/web/screens/Clients.tsx.
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { actorOf, meets } from '@/lib/access';
import { errorKey } from '@/lib/api';
import { activeClients, clientRows, isTruncated, newThisMonth, RECORD_LIMIT } from '@/lib/sections';
import { useClients, useServiceRecords } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { Ico } from '@/web/icons';
import { ClientsView, type ClientRowView } from '@/web/screens/Clients';
import { useNow } from '@/web/services/useNow';
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
  const nowMs = useNow();

  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setApplied(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const everyone = useClients('');
  const clients = useClients(applied);
  const records = useServiceRecords(undefined, canRecords);

  const date = useMemo(() => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: business.timezone }), [language, business.timezone]);
  const rows = useMemo<ClientRowView[]>(
    () =>
      clientRows(clients.data ?? [], canRecords ? records.data : undefined).map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        since: date.format(new Date(row.createdAt)),
        visits: row.visits === null ? null : String(row.visits),
        lastVisit: row.lastVisit ? date.format(new Date(row.lastVisit)) : null,
        href: `/client/${row.id}`,
      })),
    [clients.data, records.data, canRecords, date],
  );

  const now = new Date(nowMs);
  const kpis: KpiView[] = [
    { id: 'total', icon: 'users', label: t('sec_kpi_clients_total'), value: everyone.data ? String(everyone.data.length) : '—', loading: everyone.isLoading },
    { id: 'month', icon: 'plus', label: t('sec_kpi_new_month'), value: everyone.data ? String(newThisMonth(everyone.data, business.timezone, now)) : '—', loading: everyone.isLoading },
    ...(canRecords ? [{ id: 'active', icon: 'activity' as const, label: t('sec_kpi_active'), value: records.data ? String(activeClients(records.data, 30, now)) : '—', loading: records.isLoading }] : []),
  ];

  const addClient = () => router.push('/client/form');
  const state = clients.isPending ? 'loading' : clients.isError ? 'error' : 'ready';

  return (
    <Screen
      header={
        <Header
          root
          title={t('clients')}
          subtitle={t('sec_clients_sub')}
          right={
            canManage ? (
              <Button icon={<Ico name="plus" size={18} />} onPress={addClient}>
                {t('add')}
              </Button>
            ) : undefined
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
        note={canRecords && records.data && isTruncated(records.data) ? t('sec_records_note', { n: RECORD_LIMIT }) : undefined}
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
