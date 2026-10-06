/**
 * "Ventas de hoy" (Tarea 3/5), versión nativa: a donde llevan las tarjetas "Ventas hoy" y "Servicios hoy" del tablero
 * de Inicio. Cada venta con hora, cliente, líneas, empleado, forma de pago, total y acumulado; el dueño puede anular
 * con motivo. Hermana de sales-today.web.tsx.
 */
import { formatMoney, type Currency, type SalePaymentMethod } from '@xiro/shared';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { dayRange, formatClock, localTime, todayIn } from '@/lib/agenda';
import { api, errorKey } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { useInvalidateSales, useSales } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Card, Chip, ChipRow, EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { space } from '@/ui/theme';

const PAYMENT_METHODS: SalePaymentMethod[] = ['cash', 'card', 'nequi', 'bank_transfer', 'other'];

export default function SalesTodayNative() {
  const { t, colors, language } = useSettings();
  const { user, business } = useAuthed();
  const isOwner = user.role === 'owner';
  const currency = business.currency as Currency;
  const fmt = (n: number) => formatMoney(n, currency);
  const invalidateSales = useInvalidateSales();

  const todayKey = todayIn(business.timezone);
  const range = dayRange(todayKey, business.timezone, 1);
  const sales = useSales(range);

  const [paymentFilter, setPaymentFilter] = useState<SalePaymentMethod | null>(null);
  const [statusFilter, setStatusFilter] = useState<'completed' | 'voided' | null>(null);
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState<string>();

  const chronological = [...(sales.data ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const filtered = chronological.filter((s) => (statusFilter === null || s.status === statusFilter) && (paymentFilter === null || s.payments.some((p) => p.method === paymentFilter)));

  let running = 0;
  const rows = filtered.map((sale) => {
    if (sale.status === 'completed') running += sale.total;
    return { sale, running };
  });

  const completed = chronological.filter((s) => s.status === 'completed');
  const totalToday = completed.reduce((sum, s) => sum + s.total, 0);

  async function confirmVoid(id: string) {
    if (!voidReason.trim()) return setVoidError(t('sale_void_reason_required'));
    setVoidBusy(true);
    setVoidError(undefined);
    try {
      await api.voidSale(id, voidReason.trim());
      await invalidateSales(true);
      setVoidTarget(null);
      setVoidReason('');
    } catch (error) {
      setVoidError(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      setVoidBusy(false);
    }
  }

  return (
    <Screen refreshing={sales.isRefetching} onRefresh={() => void sales.refetch()} header={<Header title={t('nav_sales_today')} />}>
      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
        <Card style={{ flex: 1 }}>
          <AppText variant="small" tone="muted">
            {t('sale_kpi_total')}
          </AppText>
          <AppText variant="heading" tone="gold">
            {sales.data ? fmt(totalToday) : '—'}
          </AppText>
        </Card>
        <Card style={{ flex: 1 }}>
          <AppText variant="small" tone="muted">
            {t('sale_kpi_count')}
          </AppText>
          <AppText variant="heading" tone="gold">
            {sales.data ? String(completed.length) : '—'}
          </AppText>
        </Card>
      </View>

      {chronological.length > 0 ? (
        <>
          <ChipRow label={t('sale_filter_payment')}>
            <Chip label={t('sale_filter_all')} selected={paymentFilter === null} onPress={() => setPaymentFilter(null)} />
            {PAYMENT_METHODS.map((m) => (
              <Chip key={m} label={t(`sale_pay_${m}`)} selected={paymentFilter === m} onPress={() => setPaymentFilter(m)} />
            ))}
          </ChipRow>
          <ChipRow label={t('sale_filter_status')}>
            <Chip label={t('sale_filter_all')} selected={statusFilter === null} onPress={() => setStatusFilter(null)} />
            <Chip label={t('sale_filter_completed')} selected={statusFilter === 'completed'} onPress={() => setStatusFilter('completed')} />
            <Chip label={t('sale_filter_voided')} selected={statusFilter === 'voided'} onPress={() => setStatusFilter('voided')} />
          </ChipRow>
        </>
      ) : null}

      {sales.isPending ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
      ) : sales.isError ? (
        <AppText tone="danger" center style={{ marginTop: 24 }}>
          {t(errorKey(sales.error))}
        </AppText>
      ) : rows.length === 0 ? (
        <EmptyState icon="cash-outline" message={t(chronological.length > 0 ? 'sale_no_results' : 'sale_empty_title')} />
      ) : (
        <View style={{ gap: space.sm }}>
          {rows.map(({ sale, running: acc }) => {
            const employees = [...new Set(sale.items.map((i) => i.employeeName).filter((n): n is string => Boolean(n)))];
            const methods = [...new Set(sale.payments.map((p) => p.method))];
            const voiding = voidTarget === sale.id;
            return (
              <Card key={sale.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xs }}>
                  <AppText variant="bodyStrong">{sale.clientName}</AppText>
                  <AppText variant="small" tone="muted">
                    {formatClock(localTime(sale.createdAt, business.timezone), language)}
                  </AppText>
                </View>
                <AppText variant="small" tone="muted" style={{ marginBottom: space.xs }}>
                  {sale.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(', ')}
                </AppText>
                {employees.length > 0 ? (
                  <AppText variant="small" tone="muted">
                    {t('sale_col_employee')}: {employees.join(', ')}
                  </AppText>
                ) : null}
                <AppText variant="small" tone="muted" style={{ marginBottom: space.sm }}>
                  {methods.map((m) => t(`sale_pay_${m}`)).join(', ')}
                </AppText>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText tone={sale.status === 'voided' ? 'danger' : 'success'} variant="small">
                    {t(sale.status === 'voided' ? 'sale_status_voided' : 'sale_status_completed')}
                  </AppText>
                  <AppText variant="bodyStrong">{fmt(sale.total)}</AppText>
                </View>
                <AppText variant="small" tone="muted" style={{ textAlign: 'right' }}>
                  {t('sale_col_running')}: {fmt(acc)}
                </AppText>
                {sale.status === 'voided' && sale.voidReason ? (
                  <AppText variant="small" tone="danger">
                    {t('sale_voided_reason', { reason: sale.voidReason })}
                  </AppText>
                ) : null}

                {isOwner && sale.status === 'completed' ? (
                  voiding ? (
                    <View style={{ marginTop: space.sm }}>
                      <Field label={t('sale_void_reason')} value={voidReason} onChangeText={setVoidReason} />
                      {voidError ? (
                        <AppText tone="danger" variant="small" style={{ marginBottom: space.sm }}>
                          {voidError}
                        </AppText>
                      ) : null}
                      <View style={{ flexDirection: 'row', gap: space.sm }}>
                        <Button label={t('sale_void_confirm')} variant="danger" compact loading={voidBusy} onPress={() => void confirmVoid(sale.id)} style={{ flex: 1 }} />
                        <Button
                          label={t('cancel')}
                          variant="ghost"
                          compact
                          onPress={() => {
                            setVoidTarget(null);
                            setVoidReason('');
                            setVoidError(undefined);
                          }}
                          style={{ flex: 1 }}
                        />
                      </View>
                    </View>
                  ) : (
                    <Button
                      label={t('sale_void_action')}
                      variant="ghost"
                      compact
                      icon="close-circle-outline"
                      onPress={() => setVoidTarget(sale.id)}
                      style={{ alignSelf: 'flex-start', marginTop: space.sm }}
                    />
                  )
                ) : null}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
