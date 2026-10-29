/**
 * Pedidos de solo productos que llegan desde la página pública (Fase 1 del plan): el cliente los recoge y paga en el local.
 * Una sola pantalla para Android, iOS y la web (como la Agenda). Separados de las citas. Acciones: marcar listo, entregar y
 * cobrar (abre "Nueva venta" precargada: la venta descuenta el inventario y marca el pedido entregado), cancelar, llamar y
 * WhatsApp. En la web se refresca sola por el aviso en tiempo real; en el teléfono, al volver a la pantalla y con el push.
 */
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, whatsappLink, type Currency, type ProductOrderDto, type ProductOrdersQuery, appliedDiscountLabel } from '@xiro/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Linking, RefreshControl, StyleSheet, View } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { flatPages, ordersPagesKey, refreshFromStart, useBookingSettings, useInvalidateOrders, useOrdersPages } from '@/lib/queries';
import { useRealtimeOrders } from '@/lib/realtime';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Card, Chip, ChipRow, EmptyState } from '@/ui/Kit';
import { PagedFooter } from '@/ui/PagedFooter';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius, space } from '@/ui/theme';

type Filter = NonNullable<ProductOrdersQuery['status']>;
const FILTERS: Array<{ id: Filter | 'all'; labelKey: string }> = [
  { id: 'open', labelKey: 'orders_filter_open' },
  { id: 'all', labelKey: 'orders_filter_all' },
  { id: 'delivered', labelKey: 'orders_filter_delivered' },
  { id: 'cancelled', labelKey: 'orders_filter_cancelled' },
];

export default function Orders() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, colors, language } = useSettings();
  const { user, business } = useAuthed();
  const { confirm, toast } = useDialogs();
  const currency = business.currency as Currency;
  const [filter, setFilter] = useState<Filter | 'all'>('open');
  const status = filter === 'all' ? undefined : filter;
  const orders = useOrdersPages(status);
  const rows = useMemo(() => flatPages(orders.data), [orders.data]);
  const invalidate = useInvalidateOrders();
  // Solo quien gestiona la página pública puede ver si los pedidos están activados (para explicar por qué no llegan).
  const canManagePage = meets(actorOf(user), ['public_page_manage']);
  const settings = useBookingSettings(canManagePage);
  const ordersOff = canManagePage && settings.data?.settings.productOrdersEnabled === false;
  const [busyId, setBusyId] = useState<string | null>(null);

  useRealtimeOrders(useCallback(() => void invalidate(), [invalidate]));
  useFocusEffect(useCallback(() => void orders.refetch(), [orders.refetch]));

  const when = (iso: string) =>
    new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-CO', { timeZone: business.timezone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  async function run(order: ProductOrderDto, action: () => Promise<unknown>) {
    setBusyId(order.id);
    try {
      await action();
      await invalidate();
    } catch (error) {
      toast(apiErrors(error, t).general ?? t('unknown_error'));
      await invalidate(); // otra persona pudo cambiarlo: se muestra el estado real
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(order: ProductOrderDto) {
    const ok = await confirm({ title: t('order_action_cancel'), message: t('order_cancel_confirm', { name: order.clientName }), confirmLabel: t('order_action_cancel'), destructive: true });
    if (ok) await run(order, () => api.orderCancel(order.id));
  }

  const renderOrder = ({ item: order }: { item: ProductOrderDto }) => {
    const open = order.status === 'pending' || order.status === 'ready';
    const tone = order.status === 'pending' ? colors.gold : order.status === 'ready' ? colors.success : order.status === 'cancelled' ? colors.danger : colors.textMuted;
    const message = t('order_ready_whatsapp', { name: order.customerName.split(' ')[0] ?? order.customerName, business: business.name, total: formatMoney(order.totalPrice - (order.discount?.amount ?? 0), currency) });
    return (
      <Card style={styles.card}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {order.clientName}
            </AppText>
            <AppText variant="small" tone="muted">
              {when(order.createdAt)} · {order.customerPhone}
            </AppText>
          </View>
          <View style={[styles.badge, { borderColor: tone }]} accessibilityLabel={t(`order_status_${order.status}`)}>
            <AppText variant="small" style={{ color: tone }}>
              {t(`order_status_${order.status}`)}
            </AppText>
          </View>
        </View>

        <View style={styles.lines}>
          {order.items.map((line) => (
            <View key={line.id} style={styles.line}>
              <AppText style={{ flex: 1 }} numberOfLines={2}>
                {line.quantity}× {line.name}
              </AppText>
              <AppText tone="muted">{formatMoney(line.unitPrice * line.quantity, currency)}</AppText>
            </View>
          ))}
          {order.discount && order.discount.amount > 0 ? (
            <View style={styles.line}>
              <AppText tone="success" style={{ flex: 1 }}>
                {appliedDiscountLabel(t, order.discount, 'birthday_applied')}
              </AppText>
              <AppText tone="success">−{formatMoney(order.discount.amount, currency)}</AppText>
            </View>
          ) : null}
          <View style={[styles.line, styles.total, { borderTopColor: colors.border }]}>
            <AppText variant="bodyStrong" style={{ flex: 1 }}>
              {t('pub_summary_total')}
            </AppText>
            <AppText variant="bodyStrong">{formatMoney(order.totalPrice - (order.discount?.amount ?? 0), currency)}</AppText>
          </View>
        </View>

        {order.customerNotes ? (
          <AppText variant="small" tone="muted">
            {t('order_note')}: {order.customerNotes}
          </AppText>
        ) : null}
        {order.status === 'cancelled' && order.cancelReason ? (
          <AppText variant="small" tone="muted">
            {t('order_cancel_reason')}: {order.cancelReason}
          </AppText>
        ) : null}

        {open ? (
          <View style={styles.actions}>
            {order.status === 'pending' ? <Button label={t('order_action_ready')} variant="secondary" compact loading={busyId === order.id} onPress={() => void run(order, () => api.orderReady(order.id))} /> : null}
            <Button label={t('order_action_deliver')} icon="bag-check-outline" compact onPress={() => router.push({ pathname: '/sale/new', params: { orderId: order.id } })} />
            <Button label={t('order_action_cancel')} variant="ghost" compact onPress={() => void cancel(order)} />
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button label={t('order_action_call')} icon="call-outline" variant="ghost" compact onPress={() => void Linking.openURL(`tel:+${order.customerPhone}`)} />
          <Button label={t('order_action_whatsapp')} icon="logo-whatsapp" variant="ghost" compact onPress={() => void Linking.openURL(whatsappLink(order.customerPhone, message))} />
        </View>
      </Card>
    );
  };

  return (
    <Screen scroll={false} header={<Header title={t('orders_title')} subtitle={t('orders_subtitle')} />}>
      <FlatList
        data={rows}
        keyExtractor={(order) => order.id}
        renderItem={renderOrder}
        ListHeaderComponent={
          <View style={{ marginBottom: space.md }}>
            <ChipRow label={t('orders_title')}>
              {FILTERS.map((f) => (
                <Chip key={f.id} label={t(f.labelKey)} selected={filter === f.id} onPress={() => setFilter(f.id)} />
              ))}
            </ChipRow>
            {ordersOff ? (
              <View style={[styles.note, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
                <Ionicons name="information-circle-outline" size={18} color={colors.gold} />
                <AppText variant="small" style={{ flex: 1 }}>
                  {t('orders_disabled_hint')}
                </AppText>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={orders.isPending ? <PagedFooter loading error={null} onRetry={() => undefined} /> : <EmptyState icon="bag-handle-outline" message={t(filter === 'open' ? 'orders_empty_open' : 'orders_empty')} />}
        ListFooterComponent={rows.length > 0 ? <PagedFooter loading={orders.isFetchingNextPage} error={orders.isFetchNextPageError ? orders.error : null} onRetry={() => void orders.fetchNextPage()} /> : null}
        onEndReached={() => orders.hasNextPage && !orders.isFetchingNextPage && void orders.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={orders.isRefetching && !orders.isFetchingNextPage} onRefresh={() => void refreshFromStart(queryClient, ordersPagesKey(status))} tintColor={colors.gold} />}
      />
    </Screen>
  );
}

const Separator = () => <View style={{ height: space.md }} />;

const styles = StyleSheet.create({
  list: { paddingBottom: 32 },
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 2 },
  lines: { gap: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  total: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, padding: 10, marginTop: space.sm },
});
