/**
 * "Registrar venta" (Tarea 5), versión nativa: cliente, catálogo o líneas a mano, y el pago — pensada para ser rápida
 * en el mostrador (cliente + un servicio + efectivo en pocos toques). Misma lógica pura que la web (src/lib/sale.ts),
 * presentación propia con los componentes nativos. Hermana de sale/new.web.tsx.
 */
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, normalizePhone, whatsappLink, type Currency, type Item, type SaleDto, type SaleInput } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { dayRange, formatClock, localTime, summarizeItems, todayIn } from '@/lib/agenda';
import { api } from '@/lib/api';
import { apiErrors, toInt } from '@/lib/forms';
import { flatPages, useAppointments, useCategories, useClientSearch, useEmployees, useInvalidateAfterSale, useItemsPages } from '@/lib/queries';
import { changeDue, cartSubtotal, insufficientStockLines, paymentsTotal, remainingToPay, saleTotal, type CartLine, type PaymentRow } from '@/lib/sale';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { BancolombiaBadge, NequiBadge } from '@/ui/brand/logos';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Card, Chip, ChipRow, EmptyState, SectionTitle } from '@/ui/Kit';
import { PopIn } from '@/ui/PopIn';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius, space } from '@/ui/theme';

let lineCounter = 0;
const nextKey = () => `line-${(lineCounter += 1)}`;

const PAYMENT_METHODS = ['cash', 'card', 'nequi', 'bank_transfer', 'other'] as const;
/** Ícono o logo oficial de cada forma de pago: Nequi y Bancolombia como marca propia; el resto con Ionicons. */
const PAYMENT_ICON: Record<(typeof PAYMENT_METHODS)[number], (color: string) => ReactNode> = {
  cash: (color) => <Ionicons name="cash-outline" size={16} color={color} />,
  card: (color) => <Ionicons name="card-outline" size={16} color={color} />,
  nequi: () => <NequiBadge size={16} />,
  bank_transfer: () => <BancolombiaBadge size={16} />,
  other: (color) => <Ionicons name="wallet-outline" size={16} color={color} />,
};

export default function SaleNewNative() {
  const router = useRouter();
  const { t, colors, language } = useSettings();
  const { user, business } = useAuthed();
  const actor = actorOf(user);
  const canOverridePrice = meets(actor, ['catalog_manage']);
  const canAgenda = meets(actor, ['agenda_own']);
  const currency = business.currency as Currency;
  const fmt = (n: number) => formatMoney(n, currency);
  const invalidateAfterSale = useInvalidateAfterSale();

  /* ---------- Cliente ---------- */
  const [clientQuery, setClientQuery] = useState('');
  const searching = clientQuery.trim().length >= 2;
  // Búsqueda en el servidor (primera página): no se descarga el directorio.
  const clientResults = useClientSearch(clientQuery.trim(), searching);
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string; phone: string | null } | null>(null);
  const [occasional, setOccasional] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientBusy, setNewClientBusy] = useState(false);
  const [newClientError, setNewClientError] = useState<string>();

  function pickClient(client: { id: string; name: string; phone: string | null }) {
    setSelectedClient(client);
    setOccasional(false);
    setClientQuery('');
    setNewClientOpen(false);
    setAppointmentLoaded(false);
  }
  function changeClient() {
    setSelectedClient(null);
    setOccasional(false);
    setAppointmentLoaded(false);
  }
  async function saveNewClient() {
    if (!newClientName.trim()) return setNewClientError(t('required'));
    setNewClientBusy(true);
    setNewClientError(undefined);
    try {
      const created = await api.createClient({ name: newClientName.trim(), phone: newClientPhone.trim() || undefined });
      pickClient({ id: created.id, name: created.name, phone: created.phone });
      setNewClientName('');
      setNewClientPhone('');
    } catch (error) {
      setNewClientError(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      setNewClientBusy(false);
    }
  }

  /* ---------- Cita de hoy ---------- */
  const todayKey = todayIn(business.timezone);
  const todayRange = useMemo(() => dayRange(todayKey, business.timezone, 1), [todayKey, business.timezone]);
  const appointments = useAppointments(todayRange, canAgenda && Boolean(selectedClient));
  const categories = useCategories();
  const clientAppointment = useMemo(() => {
    if (!selectedClient || !appointments.data) return null;
    return appointments.data.find((a) => a.client.id === selectedClient.id && a.status !== 'cancelled' && a.status !== 'no_show') ?? null;
  }, [selectedClient, appointments.data]);
  const [appointmentLoaded, setAppointmentLoaded] = useState(false);

  /** Carga la cita del cliente en el carrito con los precios del catálogo: pide SOLO esos artículos (por id). */
  async function loadAppointment() {
    if (!clientAppointment) return;
    const ids = [...new Set(clientAppointment.items.filter((line) => line.kind !== 'package' && line.itemId).map((line) => line.itemId!))];
    const fetched = await Promise.all(ids.map((id) => api.item(id).catch(() => null)));
    const byId = new Map(fetched.filter((item): item is Item => item !== null).map((item) => [item.id, item]));
    const added: CartLine[] = [];
    for (const line of clientAppointment.items) {
      if (line.kind === 'package' || !line.itemId) continue;
      const catalogItem = byId.get(line.itemId);
      if (!catalogItem) continue;
      added.push({
        key: nextKey(),
        kind: catalogItem.kind === 'product' ? 'product' : 'service',
        itemId: catalogItem.id,
        name: catalogItem.name,
        unitPrice: catalogItem.price,
        catalogPrice: catalogItem.price,
        quantity: line.quantity,
        employeeId: catalogItem.kind === 'product' ? null : clientAppointment.professional.id,
        saveToCatalog: false,
        stock: catalogItem.kind === 'product' ? catalogItem.stock : null,
      });
    }
    if (added.length > 0) setLines((prev) => [...prev, ...added]);
    setAppointmentLoaded(true);
  }

  /* ---------- Catálogo ---------- */
  const [tab, setTab] = useState<'service' | 'product'>('service');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState('');
  const [appliedItemQuery, setAppliedItemQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setAppliedItemQuery(itemQuery.trim()), 300);
    return () => clearTimeout(id);
  }, [itemQuery]);
  // Catálogo del POS paginado: tipo, categoría y búsqueda (sin tildes) en el servidor; "Cargar más" al final.
  const items = useItemsPages({ kind: tab, categoryId: categoryFilter ?? undefined, q: appliedItemQuery || undefined });
  const catalogRows = useMemo(() => flatPages(items.data), [items.data]);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualKind, setManualKind] = useState<'service' | 'product'>('service');
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualSaveToCatalog, setManualSaveToCatalog] = useState(false);
  const [manualError, setManualError] = useState<string>();

  const [lines, setLines] = useState<CartLine[]>([]);
  const updateLine = (key: string, patch: Partial<CartLine>) => setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  function addCatalogLine(row: Item) {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === row.id && l.kind === tab);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key: nextKey(), kind: tab, itemId: row.id, name: row.name, unitPrice: row.price, catalogPrice: row.price, quantity: 1, employeeId: tab === 'service' ? user.id : null, saveToCatalog: false, stock: tab === 'product' ? row.stock : null }];
    });
  }
  function addManualLine() {
    if (!manualName.trim()) return setManualError(t('required'));
    const price = toInt(manualPrice);
    if (price <= 0) return setManualError(t('sale_manual_price'));
    setManualError(undefined);
    setLines((prev) => [...prev, { key: nextKey(), kind: manualKind, itemId: null, name: manualName.trim(), unitPrice: price, catalogPrice: null, quantity: 1, employeeId: manualKind === 'service' ? user.id : null, saveToCatalog: manualSaveToCatalog, stock: null }]);
    setManualName('');
    setManualPrice('');
    setManualSaveToCatalog(false);
    setManualOpen(false);
  }

  const employeesQuery = useEmployees(user.role === 'owner');
  const employees = useMemo(() => {
    const self = { id: user.id, name: t('sale_cart_employee_me') };
    const rest = (employeesQuery.data ?? []).filter((e) => e.active && e.id !== user.id).map((e) => ({ id: e.id, name: e.name }));
    return [self, ...rest];
  }, [employeesQuery.data, user.id, t]);

  /* ---------- Descuento, propina, pagos ---------- */
  const [discount, setDiscount] = useState('');
  const [tip, setTip] = useState('');
  const [payments, setPayments] = useState<PaymentRow[]>([{ key: 'pay-1', method: 'cash', amount: 0, receivedAmount: null }]);

  const subtotal = cartSubtotal(lines);
  const total = saleTotal(subtotal, toInt(discount), toInt(tip));

  const [totalSyncedTo, setTotalSyncedTo] = useState(total);
  if (total !== totalSyncedTo) {
    setTotalSyncedTo(total);
    if (payments.length === 1) setPayments([{ ...payments[0]!, amount: total }]);
  }

  function addPayment() {
    setPayments((prev) => [...prev, { key: `pay-${prev.length + 1}-${Date.now()}`, method: 'cash', amount: Math.max(0, remainingToPay(total, prev)), receivedAmount: null }]);
  }

  /* ---------- Envío ---------- */
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(SaleDto & { rewardJustEarned: boolean }) | null>(null);

  function validate(): string | undefined {
    if (!selectedClient && !occasional) return t('sale_error_client_required');
    if (lines.length === 0) return t('sale_error_no_lines');
    if (toInt(discount) > subtotal) return t('sale_error_discount');
    if (insufficientStockLines(lines).length > 0) return t('sale_cart_insufficient_stock', { n: insufficientStockLines(lines)[0]!.stock ?? 0 });
    if (paymentsTotal(payments) !== total) return t('sale_error_payments_mismatch');
    return undefined;
  }

  async function submit() {
    const problem = validate();
    if (problem) return setError(problem);
    setError(undefined);
    setBusy(true);
    try {
      const body: SaleInput = {
        clientId: selectedClient?.id ?? null,
        occasional: !selectedClient,
        clientLabel: '',
        discount: toInt(discount),
        tip: toInt(tip),
        lines: lines.map((line) => ({
          kind: line.kind,
          itemId: line.itemId,
          name: line.itemId ? '' : line.name,
          unitPrice: line.itemId && line.unitPrice === line.catalogPrice ? null : line.unitPrice,
          quantity: line.quantity,
          employeeId: line.employeeId,
          saveToCatalog: line.saveToCatalog,
        })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, receivedAmount: p.receivedAmount })),
      };
      const created = await api.createSale(body);
      await invalidateAfterSale();
      setResult(created);
    } catch (e) {
      setError(apiErrors(e, t).general ?? t('unknown_error'));
    } finally {
      setBusy(false);
    }
  }

  function resetAll() {
    setSelectedClient(null);
    setOccasional(false);
    setAppointmentLoaded(false);
    setLines([]);
    setDiscount('');
    setTip('');
    setPayments([{ key: 'pay-1', method: 'cash', amount: 0, receivedAmount: null }]);
    setError(undefined);
    setResult(null);
  }

  function sendWhatsapp() {
    if (!result) return;
    const lineTexts = result.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join('\n');
    const message = `${t('sale_receipt_greeting', { client: result.clientName, business: business.name })}\n\n${lineTexts}\n\n${t('sale_receipt_total', { total: fmt(result.total) })}\n\n${t('sale_receipt_thanks')}`;
    const phone = selectedClient?.phone ?? '';
    void Linking.openURL(normalizePhone(phone) ? whatsappLink(phone, message) : `https://wa.me/?text=${encodeURIComponent(message)}`);
  }

  if (result) {
    return (
      <Screen header={<Header title={t('sale_new_title')} />}>
        <View style={styles.doneWrap}>
          <PopIn>
            <View style={[styles.doneIcon, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
              <Ionicons name="checkmark-circle" size={40} color={colors.gold} />
            </View>
          </PopIn>
          <AppText variant="title" center tone="gold" style={{ marginBottom: space.sm }}>
            {t('sale_done_title')}
          </AppText>
          {result.rewardJustEarned ? (
            <AppText center style={{ marginBottom: space.md }}>
              {t('sale_done_reward')}
            </AppText>
          ) : null}
          <Card style={{ marginBottom: space.lg }}>
            <View style={styles.summaryRow}>
              <AppText tone="muted">{t('sale_done_total')}</AppText>
              <AppText variant="bodyStrong">{fmt(result.total)}</AppText>
            </View>
            {result.changeGiven > 0 ? (
              <View style={styles.summaryRow}>
                <AppText tone="muted">{t('sale_done_change')}</AppText>
                <AppText variant="bodyStrong">{fmt(result.changeGiven)}</AppText>
              </View>
            ) : null}
          </Card>
          <Button label={t('sale_done_whatsapp')} icon="logo-whatsapp" variant="secondary" onPress={sendWhatsapp} style={{ marginBottom: space.sm }} />
          <Button label={t('sale_done_new')} onPress={resetAll} style={{ marginBottom: space.sm }} />
          <Button label={t('sale_done_close')} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen header={<Header title={t('sale_new_title')} />} footer={<Button label={`${t('sale_submit_cta')} · ${fmt(total)}`} onPress={() => void submit()} loading={busy} />}>
      {/* ---------- Cliente ---------- */}
      <SectionTitle>{t('sale_client_title')}</SectionTitle>
      {selectedClient || occasional ? (
        <Card style={{ marginBottom: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{selectedClient?.name ?? t('sale_client_occasional')}</AppText>
            {occasional && !selectedClient ? (
              <AppText variant="small" tone="muted">
                {t('sale_client_occasional_hint')}
              </AppText>
            ) : null}
          </View>
          <Button label={t('sale_client_change')} variant="secondary" compact onPress={changeClient} />
        </Card>
      ) : (
        <>
          <Field label={t('sale_client_search_label')} value={clientQuery} onChangeText={setClientQuery} />
          <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.sm }}>
            <Button label={t('sale_client_occasional')} variant="secondary" compact style={{ flex: 1 }} onPress={() => { setOccasional(true); setSelectedClient(null); setClientQuery(''); }} />
            <Button label={t('sale_client_new')} variant="secondary" compact style={{ flex: 1 }} onPress={() => setNewClientOpen((v) => !v)} />
          </View>
          {newClientOpen ? (
            <Card style={{ marginBottom: space.md }}>
              <Field label={t('sale_client_new_name')} value={newClientName} onChangeText={setNewClientName} />
              <Field label={t('sale_client_new_phone')} value={newClientPhone} onChangeText={setNewClientPhone} keyboardType="phone-pad" />
              {newClientError ? <AppText tone="danger" variant="small" style={{ marginBottom: space.sm }}>{newClientError}</AppText> : null}
              <Button label={t('sale_client_new_save')} compact loading={newClientBusy} onPress={() => void saveNewClient()} />
            </Card>
          ) : null}
          {searching ? (
            (clientResults.data?.data ?? []).length > 0 ? (
              <View style={{ marginBottom: space.md }}>
                {(clientResults.data?.data ?? []).map((client) => (
                  <Pressable key={client.id} accessibilityRole="button" onPress={() => pickClient(client)} style={[styles.clientRow, { borderColor: colors.border }]}>
                    <AppText variant="bodyStrong">{client.name}</AppText>
                    {client.phone ? <AppText variant="small" tone="muted">{client.phone}</AppText> : null}
                  </Pressable>
                ))}
              </View>
            ) : (
              <AppText tone="muted" variant="small" style={{ marginBottom: space.md }}>
                {t('sale_client_no_results')}
              </AppText>
            )
          ) : null}
        </>
      )}

      {clientAppointment ? (
        <Card style={{ marginBottom: space.md, backgroundColor: colors.goldTint, borderColor: colors.gold }}>
          <AppText variant="small">{t('sale_client_appt_hint', { time: formatClock(localTime(clientAppointment.startsAt, business.timezone), language), items: summarizeItems(clientAppointment.items) })}</AppText>
          {appointmentLoaded ? (
            <AppText variant="small" tone="gold">
              {t('sale_client_appt_loaded')}
            </AppText>
          ) : (
            <Button label={t('sale_client_appt_load')} compact variant="secondary" onPress={() => void loadAppointment()} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} />
          )}
        </Card>
      ) : null}

      {/* ---------- Catálogo ---------- */}
      <SectionTitle>{t('sale_items_title')}</SectionTitle>
      <ChipRow label={t('sale_items_title')}>
        <Chip label={t('sale_items_tab_services')} selected={tab === 'service'} onPress={() => setTab('service')} />
        <Chip label={t('sale_items_tab_products')} selected={tab === 'product'} onPress={() => setTab('product')} />
      </ChipRow>
      <Field label={t('sale_items_search_label')} value={itemQuery} onChangeText={setItemQuery} />
      {categories.data && categories.data.length > 0 ? (
        <ChipRow label={t('sale_items_all_categories')}>
          <Chip label={t('sale_items_all_categories')} selected={categoryFilter === null} onPress={() => setCategoryFilter(null)} />
          {categories.data.map((c) => (
            <Chip key={c.id} label={c.name} selected={categoryFilter === c.id} onPress={() => setCategoryFilter(c.id)} />
          ))}
        </ChipRow>
      ) : null}
      {items.isPending ? (
        <AppText tone="muted" variant="small" style={{ marginBottom: space.md }}>
          {t('loading')}
        </AppText>
      ) : catalogRows.length === 0 ? (
        <EmptyState icon="search-outline" message={t(tab === 'service' ? 'sale_items_empty_services' : 'sale_items_empty_products')} />
      ) : (
        catalogRows.map((row) => {
          const outOfStock = tab === 'product' && row.stock <= 0;
          return (
            <Card key={row.id} style={{ marginBottom: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{row.name}</AppText>
                <AppText variant="small" tone="muted">
                  {fmt(row.price)}
                  {tab === 'product' ? ` · ${outOfStock ? t('sale_items_out_of_stock') : t('sale_items_stock_units', { n: row.stock })}` : ''}
                </AppText>
              </View>
              <Button label={t('sale_items_add')} compact disabled={outOfStock} onPress={() => addCatalogLine(row)} />
            </Card>
          );
        })
      )}
      {items.hasNextPage || items.isFetchNextPageError ? (
        <Button
          label={items.isFetchNextPageError ? t('retry') : t('load_more')}
          variant="ghost"
          compact
          loading={items.isFetchingNextPage}
          onPress={() => void items.fetchNextPage()}
          style={{ alignSelf: 'center', marginBottom: space.md }}
        />
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => setManualOpen((v) => !v)} style={{ marginBottom: space.md }}>
        <AppText tone="gold" variant="bodyStrong">
          {t('sale_items_manual_add')}
        </AppText>
      </Pressable>
      {manualOpen ? (
        <Card style={{ marginBottom: space.md }}>
          <ChipRow label={t('sale_manual_kind')}>
            <Chip label={t('sale_items_tab_services')} selected={manualKind === 'service'} onPress={() => setManualKind('service')} />
            <Chip label={t('sale_items_tab_products')} selected={manualKind === 'product'} onPress={() => setManualKind('product')} />
          </ChipRow>
          <Field label={t('sale_manual_name')} value={manualName} onChangeText={setManualName} />
          <Field label={t('sale_manual_price')} value={manualPrice} onChangeText={(v) => setManualPrice(v.replace(/\D/g, ''))} keyboardType="number-pad" prefix="$" />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: manualSaveToCatalog }} onPress={() => setManualSaveToCatalog((v) => !v)} style={styles.checkRow}>
            <Ionicons name={manualSaveToCatalog ? 'checkbox' : 'square-outline'} size={20} color={colors.gold} />
            <AppText variant="small" style={{ flex: 1 }}>
              {t('sale_manual_save_to_catalog')}
            </AppText>
          </Pressable>
          {manualError ? <AppText tone="danger" variant="small" style={{ marginBottom: space.sm }}>{manualError}</AppText> : null}
          <Button label={t('sale_manual_add_cta')} compact onPress={addManualLine} />
        </Card>
      ) : null}

      {/* ---------- Carrito ---------- */}
      <SectionTitle>{t('sale_cart_title')}</SectionTitle>
      {lines.length === 0 ? (
        <AppText tone="muted" variant="small" style={{ marginBottom: space.md }}>
          {t('sale_cart_empty')}
        </AppText>
      ) : (
        lines.map((line) => {
          const overStock = line.kind === 'product' && line.stock !== null && line.quantity > line.stock;
          const editablePrice = line.itemId !== null && canOverridePrice;
          return (
            <Card key={line.key} style={{ marginBottom: space.md }}>
              <View style={styles.cartTop}>
                <AppText variant="bodyStrong" style={{ flex: 1 }}>
                  {line.name}
                </AppText>
                <Pressable accessibilityRole="button" accessibilityLabel={t('sale_cart_remove')} onPress={() => setLines((prev) => prev.filter((l) => l.key !== line.key))} hitSlop={8}>
                  <Ionicons name="close" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
              <View style={styles.stepperRow}>
                <Pressable accessibilityRole="button" accessibilityLabel="-" disabled={line.quantity <= 1} onPress={() => updateLine(line.key, { quantity: line.quantity - 1 })} style={[styles.stepBtn, { borderColor: colors.border, opacity: line.quantity <= 1 ? 0.4 : 1 }]}>
                  <Ionicons name="remove" size={16} color={colors.text} />
                </Pressable>
                <AppText variant="bodyStrong" style={{ minWidth: 24, textAlign: 'center' }}>
                  {line.quantity}
                </AppText>
                <Pressable accessibilityRole="button" accessibilityLabel="+" onPress={() => updateLine(line.key, { quantity: line.quantity + 1 })} style={[styles.stepBtn, { borderColor: colors.border }]}>
                  <Ionicons name="add" size={16} color={colors.text} />
                </Pressable>
                <AppText variant="bodyStrong" style={{ marginLeft: 'auto' }}>
                  {fmt(line.unitPrice * line.quantity)}
                </AppText>
              </View>
              {editablePrice ? (
                <Field label={t('sale_cart_price_override')} hint={t('sale_cart_price_override_hint')} value={String(line.unitPrice)} onChangeText={(v) => updateLine(line.key, { unitPrice: toInt(v.replace(/\D/g, '')) })} keyboardType="number-pad" prefix="$" />
              ) : null}
              {line.kind === 'service' ? (
                <ChipRow label={t('sale_cart_employee')}>
                  {employees.map((e) => (
                    <Chip key={e.id} label={e.name} selected={line.employeeId === e.id} onPress={() => updateLine(line.key, { employeeId: e.id })} />
                  ))}
                </ChipRow>
              ) : null}
              {overStock ? (
                <AppText tone="danger" variant="small">
                  {t('sale_cart_insufficient_stock', { n: line.stock ?? 0 })}
                </AppText>
              ) : null}
            </Card>
          );
        })
      )}

      {/* ---------- Descuento, propina y pago ---------- */}
      <SectionTitle>{t('sale_pay_title')}</SectionTitle>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Field label={t('sale_discount')} value={discount} onChangeText={(v) => setDiscount(v.replace(/\D/g, ''))} keyboardType="number-pad" prefix="$" />
        <Field label={t('sale_tip')} value={tip} onChangeText={(v) => setTip(v.replace(/\D/g, ''))} keyboardType="number-pad" prefix="$" />
      </View>

      {payments.map((payment) => (
        <Card key={payment.key} style={{ marginBottom: space.sm }}>
          <ChipRow label={t('sale_pay_title')}>
            {PAYMENT_METHODS.map((m) => (
              <Chip
                key={m}
                label={t(`sale_pay_${m}`)}
                selected={payment.method === m}
                icon={PAYMENT_ICON[m](payment.method === m ? colors.gold : colors.textMuted)}
                onPress={() => setPayments((prev) => prev.map((p) => (p.key === payment.key ? { ...p, method: m, receivedAmount: m === 'cash' ? p.receivedAmount : null } : p)))}
              />
            ))}
          </ChipRow>
          <Field label={t('sale_summary_total')} value={payment.amount === 0 ? '' : String(payment.amount)} onChangeText={(v) => setPayments((prev) => prev.map((p) => (p.key === payment.key ? { ...p, amount: toInt(v.replace(/\D/g, '')) } : p)))} keyboardType="number-pad" prefix="$" />
          {payment.method === 'cash' ? (
            <Field label={t('sale_pay_received')} value={payment.receivedAmount === null ? '' : String(payment.receivedAmount)} onChangeText={(v) => setPayments((prev) => prev.map((p) => (p.key === payment.key ? { ...p, receivedAmount: v.trim() === '' ? null : toInt(v.replace(/\D/g, '')) } : p)))} keyboardType="number-pad" prefix="$" />
          ) : null}
          {payments.length > 1 ? <Button label={t('sale_pay_remove')} variant="ghost" compact onPress={() => setPayments((prev) => prev.filter((p) => p.key !== payment.key))} style={{ alignSelf: 'flex-start' }} /> : null}
        </Card>
      ))}
      <Button label={t('sale_pay_add')} variant="secondary" compact onPress={addPayment} style={{ marginBottom: space.md, alignSelf: 'flex-start' }} />

      {remainingToPay(total, payments) > 0 ? <AppText tone="muted" variant="small">{t('sale_pay_remaining', { amount: fmt(remainingToPay(total, payments)) })}</AppText> : null}
      {remainingToPay(total, payments) < 0 ? <AppText tone="danger" variant="small">{t('sale_pay_over', { amount: fmt(-remainingToPay(total, payments)) })}</AppText> : null}
      {changeDue(payments) > 0 ? (
        <AppText tone="muted" variant="small">
          {t('sale_pay_change')}: {fmt(changeDue(payments))}
        </AppText>
      ) : null}

      <Card style={{ marginTop: space.md, marginBottom: space.md }}>
        <View style={styles.summaryRow}>
          <AppText tone="muted">{t('sale_summary_subtotal')}</AppText>
          <AppText>{fmt(subtotal)}</AppText>
        </View>
        <View style={styles.summaryRow}>
          <AppText tone="muted">{t('sale_summary_total')}</AppText>
          <AppText variant="bodyStrong" tone="gold">
            {fmt(total)}
          </AppText>
        </View>
      </Card>
      {error ? (
        <AppText tone="danger" style={{ marginBottom: space.md }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  clientRow: { borderWidth: 1, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  cartTop: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  stepBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xs },
  doneWrap: { padding: space.lg },
  doneIcon: { alignSelf: 'center', width: 76, height: 76, borderRadius: 38, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
});
