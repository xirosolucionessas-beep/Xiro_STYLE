import { formatMoney, whatsappLink, type Currency } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { api, errorKey } from '@/lib/api';
import { birthdayStatusText, birthdayWhatsappUrl, formatDay } from '@/lib/birthdayText';
import { flatPages, useClient, useClientBirthday, useInvalidateClients, useServiceRecordsPages, useServiceRecordsSummary } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Card, EmptyState, SectionTitle } from '@/ui/Kit';
import { PagedFooter } from '@/ui/PagedFooter';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <AppText variant="label" tone="muted">
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={{ marginTop: 2 }}>
        {value || '—'}
      </AppText>
    </View>
  );
}

/**
 * Ficha de cliente en Android/iOS (en la Web la sirve client/[id].web.tsx). Mismos datos y acciones que la web: contacto,
 * WhatsApp y llamada; con permiso de registrar servicios, sus indicadores (servicios, total cobrado, último) y su historial
 * real; y solo con permiso de gestionar clientes, editar, anonimizar y eliminar (el servidor impone lo mismo).
 */
export default function ClientDetail() {
  const router = useRouter();
  const { t, colors, language } = useSettings();
  const { user, business } = useAuthed();
  const { confirm, toast } = useDialogs();
  const { id } = useLocalSearchParams<{ id: string }>();
  const actor = actorOf(user);
  const canRecords = meets(actor, ['services_record']);
  const canManage = meets(actor, ['clients_manage']);
  const { data: client, isPending } = useClient(id);
  // Historial paginado (50 por página, "Ver más") e indicadores calculados en el servidor sobre TODO el historial.
  const records = useServiceRecordsPages(id, canRecords && Boolean(id));
  const stats = useServiceRecordsSummary({ clientId: id }, canRecords && Boolean(id));
  const birthday = useClientBirthday(id);
  const invalidate = useInvalidateClients();
  const [busy, setBusy] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const currency = business.currency as Currency;
  const date = useMemo(() => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: business.timezone }), [language, business.timezone]);

  if (isPending) return <Screen header={<Header title={t('clients')} />}><ActivityIndicator style={{ marginTop: 40 }} /></Screen>;
  if (!client) return <Screen header={<Header title={t('clients')} />}><EmptyState icon="people-outline" message={t('not_found')} /></Screen>;

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
  const kpis = [
    { id: 'count', label: t('sec_cd_kpi_services'), value: summary ? String(summary.count) : '—' },
    { id: 'spent', label: t('sec_cd_kpi_spent'), value: summary ? formatMoney(summary.total, currency) : '—' },
    { id: 'last', label: t('sec_cd_kpi_last'), value: summary?.last ? date.format(new Date(summary.last)) : '—' },
  ];
  const history = flatPages(records.data);

  return (
    <Screen header={<Header title={client.name} subtitle={t('sec_cd_since', { date: date.format(new Date(client.createdAt)) })} />}>
      <Card>
        <Detail label={t('phone')} value={client.phone ? `+${client.phone}` : ''} />
        <Detail label={t('email')} value={client.email ?? ''} />
        <Detail label={t('address')} value={client.address} />
        <Detail label={t('client_notes')} value={client.notes} />
        {client.birthDate ? <Detail label={t('birth_date')} value={formatDay(client.birthDate)} /> : null}
      </Card>

      {/* Programa de cumpleaños: estado (sin fecha ni edad) y felicitación por WhatsApp preparada para enviar a mano. */}
      {birthday.data ? (
        <Card style={{ marginTop: 18, gap: 8 }}>
          <AppText variant="label" tone="gold">
            {t('birthday_status_title')}
          </AppText>
          <AppText accessibilityLiveRegion="polite">{birthdayStatusText(t, birthday.data, currency)}</AppText>
          {birthday.data.programEnabled && birthday.data.reward?.state === 'available' && client.phone ? (
            <>
              <Button
                label={t('birthday_whatsapp')}
                icon="logo-whatsapp"
                variant="secondary"
                onPress={() =>
                  void Linking.openURL(birthdayWhatsappUrl(t, { phone: client.phone!, clientName: client.name, businessName: business.name, reward: birthday.data!.reward!, message: birthday.data!.message, currency })).catch(() => toast(t('unknown_error')))
                }
              />
              <AppText variant="small" tone="muted">
                {t('birthday_whatsapp_note')}
              </AppText>
            </>
          ) : null}
        </Card>
      ) : null}
      {client.phone ? (
        <>
          <Button label="WhatsApp" icon="logo-whatsapp" onPress={() => void Linking.openURL(whatsappLink(client.phone!, ''))} style={{ marginTop: 18 }} />
          <Button label={t('call')} icon="call-outline" variant="secondary" onPress={() => void Linking.openURL(`tel:+${client.phone}`)} style={{ marginTop: 10 }} />
        </>
      ) : null}

      {canRecords ? (
        <>
          <View style={styles.kpis}>
            {kpis.map((kpi) => (
              <View key={kpi.id} style={[styles.kpi, { backgroundColor: colors.surface, borderColor: colors.border }]} accessible accessibilityLabel={`${kpi.label}: ${stats.isLoading ? '' : kpi.value}`}>
                <AppText variant="small" tone="muted" numberOfLines={1}>
                  {kpi.label}
                </AppText>
                {stats.isLoading ? (
                  <ActivityIndicator size="small" color={colors.gold} style={{ alignSelf: 'flex-start' }} />
                ) : (
                  <AppText variant="bodyStrong" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {kpi.value}
                  </AppText>
                )}
              </View>
            ))}
          </View>

          <SectionTitle>{t('sec_cd_history')}</SectionTitle>
          <Card>
            {records.isLoading ? (
              <ActivityIndicator color={colors.gold} style={{ marginVertical: 12 }} />
            ) : history.length === 0 ? (
              <AppText tone="muted" style={{ paddingVertical: 8 }}>
                {t('sec_cd_history_empty')}
              </AppText>
            ) : (
              history.map((record, index) => (
                <View
                  key={record.id}
                  style={[styles.historyRow, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                  accessible
                  accessibilityLabel={[record.label, record.note, formatMoney(record.amount, currency), date.format(new Date(record.createdAt))].filter(Boolean).join('. ')}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {record.label}
                    </AppText>
                    <AppText variant="small" tone="muted" numberOfLines={2}>
                      {[date.format(new Date(record.createdAt)), record.note].filter(Boolean).join(' · ')}
                    </AppText>
                  </View>
                  <AppText variant="bodyStrong">{formatMoney(record.amount, currency)}</AppText>
                </View>
              ))
            )}
            {history.length > 0 && (records.hasNextPage || records.isFetchNextPageError) ? (
              records.isFetchNextPageError || records.isFetchingNextPage ? (
                <PagedFooter loading={records.isFetchingNextPage} error={records.isFetchNextPageError ? records.error : null} onRetry={() => void records.fetchNextPage()} />
              ) : (
                <Button label={t('load_more')} variant="ghost" compact onPress={() => void records.fetchNextPage()} style={{ marginTop: 8, alignSelf: 'center' }} />
              )
            ) : null}
          </Card>
        </>
      ) : null}

      {canManage ? (
        <>
          <Button label={t('edit')} icon="create-outline" variant="secondary" onPress={() => router.push({ pathname: '/client/form', params: { id: client.id } })} style={{ marginTop: 18 }} />
          <Button label={t('client_anonymize')} icon="eye-off-outline" variant="secondary" loading={anonymizing} onPress={anonymize} style={{ marginTop: 10 }} />
          <Button label={t('delete')} icon="trash-outline" variant="danger" loading={busy} onPress={remove} style={{ marginTop: 10 }} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kpis: { flexDirection: 'row', gap: 8, marginTop: 18 },
  kpi: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: 10, gap: 4 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 },
});
