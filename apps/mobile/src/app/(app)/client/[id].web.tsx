/**
 * Ruta /client/[id] SOLO WEB (nativo: client/[id].tsx, sin cambios). Ficha de cliente con los mismos datos y acciones
 * (WhatsApp, llamar, editar, eliminar con confirmación) y, con permiso, su historial real de servicios.
 * Presentación en src/web/screens/ClientDetail.tsx.
 */
import { formatMoney, whatsappLink, type Currency } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { api, errorKey } from '@/lib/api';
import { birthdayStatusText, birthdayWhatsappUrl, formatDay } from '@/lib/birthdayText';
import { flatPages, useClient, useClientBirthday, useInvalidateClients, useServiceRecordsPages, useServiceRecordsSummary } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useDialogs } from '@/ui/Dialogs';
import { EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { ClientDetailView, type HistoryRowView } from '@/web/screens/ClientDetail';
import { useWebText } from '@/web/services/useWebText';
import type { KpiView } from '@/web/ui/Page';

export default function ClientDetailWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { user, business } = useAuthed();
  const { confirm, toast } = useDialogs();
  const { id } = useLocalSearchParams<{ id: string }>();
  const actor = actorOf(user);
  const canRecords = meets(actor, ['services_record']);
  const canManage = meets(actor, ['clients_manage']);
  const { data: client, isPending } = useClient(id);
  const birthday = useClientBirthday(id);
  // Historial paginado ("Cargar más") e indicadores calculados en el servidor sobre TODO el historial.
  const records = useServiceRecordsPages(id, canRecords && Boolean(id));
  const stats = useServiceRecordsSummary({ clientId: id }, canRecords && Boolean(id));
  const invalidate = useInvalidateClients();
  const [busy, setBusy] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const currency = business.currency as Currency;
  const date = useMemo(() => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: business.timezone }), [language, business.timezone]);

  if (isPending) {
    return (
      <Screen header={<Header title={t('clients')} />}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </Screen>
    );
  }
  if (!client) {
    return (
      <Screen header={<Header title={t('clients')} />}>
        <EmptyState icon="people-outline" message={t('not_found')} />
      </Screen>
    );
  }

  async function remove() {
    if (!client) return;
    if (!(await confirm({ title: t('confirm_delete_title'), message: `${client.name}. ${t('confirm_delete_body')}`, confirmLabel: t('delete'), destructive: true }))) return;
    setBusy(true);
    try {
      await api.deleteClient(client.id);
      await invalidate();
      router.back();
    } catch (error) {
      toast(t(errorKey(error)));
      setBusy(false);
    }
  }

  async function anonymize() {
    if (!client) return;
    if (!(await confirm({ title: t('client_anonymize_confirm_title'), message: t('client_anonymize_confirm_text'), confirmLabel: t('client_anonymize'), destructive: true }))) return;
    setAnonymizing(true);
    try {
      await api.anonymizeClient(client.id);
      await invalidate();
      toast(t('client_anonymized'));
    } catch (error) {
      toast(t(errorKey(error)));
    } finally {
      setAnonymizing(false);
    }
  }

  const summary = stats.data ? { count: stats.data.count, total: stats.data.total, last: stats.data.lastAt } : null;
  const kpis: KpiView[] = canRecords
    ? [
        { id: 'count', icon: 'scissors', label: t('sec_cd_kpi_services'), value: summary ? String(summary.count) : '—', loading: stats.isLoading },
        { id: 'spent', icon: 'coins', label: t('sec_cd_kpi_spent'), value: summary ? formatMoney(summary.total, currency) : '—', loading: stats.isLoading },
        { id: 'last', icon: 'clock', label: t('sec_cd_kpi_last'), value: summary?.last ? date.format(new Date(summary.last)) : '—', loading: stats.isLoading },
      ]
    : [];

  const history: HistoryRowView[] = flatPages(records.data).map((record) => ({ id: record.id, label: record.label, note: record.note, amount: formatMoney(record.amount, currency), date: date.format(new Date(record.createdAt)) }));

  return (
    <Screen header={<Header title={client.name} subtitle={t('sec_cd_since', { date: date.format(new Date(client.createdAt)) })} />}>
      <ClientDetailView
        t={t}
        rows={[
          { id: 'phone', label: t('phone'), value: client.phone ? `+${client.phone}` : '—', href: client.phone ? `tel:+${client.phone}` : undefined },
          { id: 'email', label: t('email'), value: client.email ?? '—', href: client.email ? `mailto:${client.email}` : undefined },
          { id: 'address', label: t('address'), value: client.address || '—' },
          { id: 'notes', label: t('client_notes'), value: client.notes || '—' },
          ...(client.birthDate ? [{ id: 'birthDate', label: t('birth_date'), value: formatDay(client.birthDate) }] : []),
        ]}
        birthday={
          birthday.data
            ? {
                text: birthdayStatusText(t, birthday.data, business.currency as Currency),
                whatsappHref:
                  birthday.data.programEnabled && birthday.data.reward?.state === 'available' && client.phone
                    ? birthdayWhatsappUrl(t, { phone: client.phone, clientName: client.name, businessName: business.name, reward: birthday.data.reward, message: birthday.data.message, currency: business.currency as Currency })
                    : undefined,
              }
            : null
        }
        history={
          canRecords
            ? {
                loading: records.isLoading,
                rows: history,
                pagination: { hasMore: Boolean(records.hasNextPage), loading: records.isFetchingNextPage, error: records.isFetchNextPageError ? t(errorKey(records.error)) : undefined, onLoadMore: () => void records.fetchNextPage() },
              }
            : null
        }
        kpis={kpis}
        whatsappHref={client.phone ? whatsappLink(client.phone, '') : undefined}
        callHref={client.phone ? `tel:+${client.phone}` : undefined}
        deleting={busy}
        canManage={canManage}
        onEdit={() => router.push({ pathname: '/client/form', params: { id: client.id } })}
        onDelete={() => void remove()}
        anonymizing={anonymizing}
        onAnonymize={() => void anonymize()}
      />
    </Screen>
  );
}
