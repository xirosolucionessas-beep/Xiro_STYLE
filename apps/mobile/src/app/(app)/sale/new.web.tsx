/**
 * Ruta /sale/new SOLO WEB (fallback nativo: sale/new.tsx redirige al inicio). "Registrar venta": cliente, catálogo o
 * líneas a mano, y el pago — todo en una sola pantalla, pensada para ser rápida en el mostrador. Presentación en
 * src/web/screens/SaleForm.tsx.
 */
import type { Client, Item, SaleDto, SaleInput } from '@xiro/shared';
import { formatMoney, normalizePhone, whatsappLink, type Currency } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { actorOf, meets } from '@/lib/access';
import { dayRange, formatClock, formatDay, localDate, localTime, summarizeItems, todayIn } from '@/lib/agenda';
import { api, errorKey, resolveMedia } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { flatPages, useAppointments, useCategories, useClientSearch, useEmployees, useInvalidateAfterSale, useItemsPages } from '@/lib/queries';
import { useOrderPrefill } from '@/lib/orderPrefill';
import { changeDue, insufficientStockLines, paymentsTotal, remainingToPay, saleTotal, cartSubtotal, type CartLine, type PaymentRow } from '@/lib/sale';
import { useAuthed } from '@/lib/session';
import { Screen } from '@/ui/Screen';
import { SaleFormView, type SaleAppointmentHint, type SaleCatalogRow, type SaleClientResult, type SaleEmployeeOption } from '@/web/screens/SaleForm';
import { businessAddressLine, downloadInvoicePdf, downloadPosTicketPdf, toDataUrl, type InvoiceItem } from '@/web/services/invoicePdf';
import { printTicket } from '@/web/services/print';
import { useWebText } from '@/web/services/useWebText';
import { parseAmountInput } from '@/web/money';

let lineCounter = 0;
const nextKey = () => `line-${(lineCounter += 1)}`;

export default function SaleNewWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  const { user, business } = useAuthed();
  const actor = actorOf(user);
  const canOverridePrice = meets(actor, ['catalog_manage']);
  const canAgenda = meets(actor, ['agenda_own']);
  const currency = business.currency as Currency;
  const invalidateAfterSale = useInvalidateAfterSale();

  /* ---------- Cliente ---------- */
  const [clientQuery, setClientQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setAppliedQuery(clientQuery.trim()), 250);
    return () => clearTimeout(id);
  }, [clientQuery]);
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string; phone: string | null } | null>(null);
  const [occasional, setOccasional] = useState(false);
  const searching = appliedQuery.length >= 2 && !selectedClient && !occasional;
  // Búsqueda en el servidor (primera página): no se descarga el directorio.
  const clientResults = useClientSearch(appliedQuery, searching);

  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientBusy, setNewClientBusy] = useState(false);
  const [newClientError, setNewClientError] = useState<string>();

  function pickClient(client: SaleClientResult) {
    setSelectedClient(client);
    setOccasional(false);
    setClientQuery('');
    setNewClientOpen(false);
  }

  async function saveNewClient() {
    if (!newClientName.trim()) return setNewClientError(t('required'));
    setNewClientBusy(true);
    setNewClientError(undefined);
    try {
      const created: Client = await api.createClient({ name: newClientName.trim(), phone: newClientPhone.trim() || undefined });
      pickClient({ id: created.id, name: created.name, phone: created.phone });
      setNewClientName('');
      setNewClientPhone('');
    } catch (error) {
      setNewClientError(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      setNewClientBusy(false);
    }
  }

  function changeClient() {
    setSelectedClient(null);
    setOccasional(false);
    setAppointmentLoaded(false);
  }

  /* ---------- Cita de hoy del cliente elegido (si tiene, ofrece cargar sus servicios) ---------- */
  const todayKey = todayIn(business.timezone);
  const todayRange = useMemo(() => dayRange(todayKey, business.timezone, 1), [todayKey, business.timezone]);
  const appointments = useAppointments(todayRange, canAgenda && Boolean(selectedClient));
  const categories = useCategories();
  const clientAppointment = useMemo(() => {
    if (!selectedClient || !appointments.data) return null;
    return appointments.data.find((a) => a.client.id === selectedClient.id && a.status !== 'cancelled' && a.status !== 'no_show') ?? null;
  }, [selectedClient, appointments.data]);
  const [appointmentLoaded, setAppointmentLoaded] = useState(false);
  const appointmentHint: SaleAppointmentHint | null = clientAppointment
    ? { time: formatClock(localTime(clientAppointment.startsAt, business.timezone), language), items: summarizeItems(clientAppointment.items) }
    : null;

  /** Carga la cita del cliente en el carrito con los precios del catálogo: pide SOLO esos artículos (por id). */
  async function loadAppointment() {
    if (!clientAppointment) return;
    const ids = [...new Set(clientAppointment.items.filter((line) => line.kind !== 'package' && line.itemId).map((line) => line.itemId!))];
    const fetched = await Promise.all(ids.map((id) => api.item(id).catch(() => null)));
    const byId = new Map(fetched.filter((item): item is Item => item !== null).map((item) => [item.id, item]));
    const added: CartLine[] = [];
    for (const line of clientAppointment.items) {
      if (line.kind === 'package' || !line.itemId) continue; // los paquetes no tienen equivalente en ventas todavía
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
    const id = setTimeout(() => setAppliedItemQuery(itemQuery.trim()), 250);
    return () => clearTimeout(id);
  }, [itemQuery]);
  // Catálogo del POS paginado: tipo, categoría y búsqueda (sin tildes) en el servidor; "Cargar más" al final.
  const items = useItemsPages({ kind: tab, categoryId: categoryFilter ?? undefined, q: appliedItemQuery || undefined });
  const catalogRows: SaleCatalogRow[] = useMemo(
    () => flatPages(items.data).map((i) => ({ id: i.id, name: i.name, price: i.price, stock: i.kind === 'product' ? i.stock : null, categoryId: i.categoryId })),
    [items.data],
  );

  const [manualOpen, setManualOpen] = useState(false);
  const [manualKind, setManualKind] = useState<'service' | 'product'>('service');
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState(0);
  const [manualSaveToCatalog, setManualSaveToCatalog] = useState(false);
  const [manualError, setManualError] = useState<string>();

  /* ---------- Carrito ---------- */
  const [lines, setLines] = useState<CartLine[]>([]);
  const updateLine = (key: string, patch: Partial<CartLine>) => setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  // Entregar un pedido de la página pública (Pedidos → "Entregar y cobrar"): cliente y productos precargados; la venta lo marca entregado.
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  // Declarado antes de precargar: un pedido con código de descuento trae ya su descuento.
  const [discount, setDiscount] = useState(0);
  const orderPrefill = useOrderPrefill(
    orderId,
    ({ client, lines: orderLines, discount: promised }) => {
      setSelectedClient(client);
      setOccasional(false);
      setLines(orderLines);
      if (promised > 0) setDiscount(promised);
    },
    nextKey,
    canOverridePrice,
  );
  const orderNotice = orderPrefill.loading
    ? { text: t('loading'), error: false }
    : orderPrefill.error
      ? { text: apiErrors(orderPrefill.error, t).general ?? t('unknown_error'), error: true }
      : orderPrefill.order
        ? { text: t('order_delivering', { name: orderPrefill.order.clientName }), error: false }
        : null;

  function addCatalogLine(row: SaleCatalogRow) {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === row.id && l.kind === tab);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key: nextKey(), kind: tab, itemId: row.id, name: row.name, unitPrice: row.price, catalogPrice: row.price, quantity: 1, employeeId: tab === 'service' ? user.id : null, saveToCatalog: false, stock: row.stock }];
    });
  }

  function addManualLine() {
    if (!manualName.trim()) return setManualError(t('required'));
    if (manualPrice <= 0) return setManualError(t('sale_manual_price'));
    setManualError(undefined);
    setLines((prev) => [...prev, { key: nextKey(), kind: manualKind, itemId: null, name: manualName.trim(), unitPrice: manualPrice, catalogPrice: null, quantity: 1, employeeId: manualKind === 'service' ? user.id : null, saveToCatalog: manualSaveToCatalog, stock: null }]);
    setManualName('');
    setManualPrice(0);
    setManualSaveToCatalog(false);
    setManualOpen(false);
  }

  const employeesQuery = useEmployees(user.role === 'owner');
  const employees: SaleEmployeeOption[] = useMemo(() => {
    const self = { id: user.id, name: t('sale_cart_employee_me') };
    const rest = (employeesQuery.data ?? []).filter((e) => e.active && e.id !== user.id).map((e) => ({ id: e.id, name: e.name }));
    return [self, ...rest];
  }, [employeesQuery.data, user.id, t]);

  /* ---------- Descuento, propina y pago ---------- */
  const [tip, setTip] = useState(0);
  const [payments, setPayments] = useState<PaymentRow[]>([{ key: 'pay-1', method: 'cash', amount: 0, receivedAmount: null }]);

  const subtotal = cartSubtotal(lines);
  const total = saleTotal(subtotal, discount, tip);

  // Con un solo pago (el caso normal: cliente + un servicio + efectivo) el monto sigue siempre al total, así que en la
  // mayoría de las ventas no hace falta tocar el pago para nada. En cuanto se agrega un segundo pago (venta partida),
  // se deja de tocar los montos: a partir de ahí los reparte la persona a mano.
  // Ajuste durante el render (no en un efecto): evita el "cascading render" de escribir estado dentro de useEffect.
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

  // El logo se trae y se convierte a data URL UNA vez, apenas hay resultado (jsPDF no acepta URLs remotas en
  // addImage): si no hay logo o falla la descarga, la factura se genera igual, solo que sin él.
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    void toDataUrl(resolveMedia(business.logoUrl)).then((url) => {
      if (!cancelled) setLogoDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al aparecer el resultado, no en cada cambio de logo
  }, [result]);

  function validate(): string | undefined {
    if (!selectedClient && !occasional) return t('sale_error_client_required');
    if (lines.length === 0) return t('sale_error_no_lines');
    if (discount > subtotal) return t('sale_error_discount');
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
        discount,
        tip,
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
        ...(orderPrefill.order ? { productOrderId: orderPrefill.order.id } : {}),
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
    orderPrefill.dismiss();
    setSelectedClient(null);
    setOccasional(false);
    setAppointmentLoaded(false);
    setLines([]);
    setDiscount(0);
    setTip(0);
    setPayments([{ key: 'pay-1', method: 'cash', amount: 0, receivedAmount: null }]);
    setError(undefined);
    setResult(null);
    setLogoDataUrl(null);
  }

  // N.° de recibo corto y estable a partir del id real de la venta — no se inventa un consecutivo aparte.
  const receiptNumber = result ? result.id.slice(0, 8).toUpperCase() : '';
  const dateLabel = result ? `${formatDay(localDate(result.createdAt, business.timezone), language)} · ${formatClock(localTime(result.createdAt, business.timezone), language)}` : '';
  const paymentLabel = result ? result.payments.map((p) => `${t(`sale_pay_${p.method}`)} ${formatMoney(p.amount, currency)}`).join(' + ') : '';
  // El nombre va sin sufijo de cantidad: tanto la factura (columna "Cant.") como el ticket (línea "cant. x precio")
  // ya muestran la cantidad por su cuenta — repetirla en el nombre quedaría dos veces.
  const invoiceItems: InvoiceItem[] = result ? result.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total })) : [];

  function downloadPdf() {
    if (!result) return;
    downloadInvoicePdf({
      businessName: business.name,
      businessAddress: businessAddressLine(business.address, business.city, business.country),
      businessPhone: business.whatsapp || null,
      logoDataUrl,
      receiptNumber,
      dateLabel,
      clientName: result.clientName,
      items: invoiceItems,
      subtotal: result.subtotal,
      discount: result.discount,
      tip: result.tip,
      total: result.total,
      paymentLabel,
      currency,
    });
  }

  /** Imprimir: un ticket vertical propio (ver web/services/print.ts), no la pantalla de la app (salía en blanco o recortada). */
  function printReceipt() {
    if (!result) return;
    printTicket({
      title: `${t('sale_print_receipt')} ${receiptNumber}`,
      lang: language,
      header: [business.name, businessAddressLine(business.address, business.city, business.country), business.whatsapp || ''],
      meta: [
        { label: t('sale_print_number'), value: receiptNumber },
        { label: t('sale_print_date'), value: dateLabel },
        { label: t('sale_print_client'), value: result.clientName },
        ...(result.createdByName ? [{ label: t('sale_print_attended'), value: result.createdByName }] : []),
      ],
      lines: result.items.map((i) => ({ name: i.name, detail: i.quantity > 1 ? `${i.quantity} × ${formatMoney(i.unitPrice, currency)}` : undefined, amount: formatMoney(i.total, currency) })),
      totals: [
        { label: t('sale_print_subtotal'), value: formatMoney(result.subtotal, currency) },
        ...(result.discount > 0 ? [{ label: t('sale_discount'), value: `-${formatMoney(result.discount, currency)}` }] : []),
        ...(result.tip > 0 ? [{ label: t('sale_tip'), value: formatMoney(result.tip, currency) }] : []),
        { label: t('sale_print_total'), value: formatMoney(result.total, currency), strong: true },
        ...result.payments.map((p) => ({ label: t(`sale_pay_${p.method}`), value: formatMoney(p.amount, currency) })),
        ...(result.changeGiven > 0 ? [{ label: t('sale_done_change'), value: formatMoney(result.changeGiven, currency) }] : []),
      ],
      footer: t('sale_receipt_thanks'),
    });
  }

  function downloadPosTicket() {
    if (!result) return;
    downloadPosTicketPdf({
      businessName: business.name,
      businessAddress: businessAddressLine(business.address, business.city, business.country),
      businessPhone: business.whatsapp || null,
      logoDataUrl,
      receiptNumber,
      dateLabel,
      clientName: result.clientName,
      items: invoiceItems,
      subtotal: result.subtotal,
      discount: result.discount,
      tip: result.tip,
      total: result.total,
      paymentLabel,
      currency,
    });
  }

  // wa.me solo abre un chat con texto: no existe una forma de adjuntar un archivo por enlace sin la API de negocio
  // de WhatsApp (credenciales que este proyecto no tiene configuradas). Como alternativa honesta, se descarga la
  // factura en PDF A LA VEZ que se abre el chat, lista para arrastrarla dentro de WhatsApp en un segundo paso.
  function sendWhatsapp() {
    if (!result) return;
    downloadPdf();
    const lineTexts = result.items.map((i) => `${i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name} — ${formatMoney(i.total, currency)}`).join('\n');
    const message = `${t('sale_receipt_greeting', { client: result.clientName, business: business.name })}\n\n${lineTexts}\n\n${t('sale_receipt_total', { total: formatMoney(result.total, currency) })}\n${t('sale_receipt_payment', { method: paymentLabel })}\n\n${t('sale_receipt_thanks')}`;
    const phone = selectedClient?.phone ?? '';
    window.open(normalizePhone(phone) ? whatsappLink(phone, message) : `https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen>
    <SaleFormView
      t={t}
      orderNotice={orderNotice}
      currency={currency}
      clientQuery={clientQuery}
      onClientQuery={setClientQuery}
      clientResults={(clientResults.data?.data ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone }))}
      clientSearchLoading={clientResults.isFetching}
      selectedClient={selectedClient}
      occasional={occasional}
      onSelectClient={pickClient}
      onOccasional={() => {
        setOccasional(true);
        setSelectedClient(null);
        setClientQuery('');
      }}
      onChangeClient={changeClient}
      newClientOpen={newClientOpen}
      onToggleNewClient={() => setNewClientOpen((v) => !v)}
      newClientName={newClientName}
      onNewClientName={setNewClientName}
      newClientPhone={newClientPhone}
      onNewClientPhone={setNewClientPhone}
      onSaveNewClient={() => void saveNewClient()}
      newClientBusy={newClientBusy}
      newClientError={newClientError}
      appointmentHint={appointmentHint}
      appointmentLoaded={appointmentLoaded}
      onLoadAppointment={() => void loadAppointment()}
      tab={tab}
      onTab={setTab}
      categories={categories.data ?? []}
      categoryFilter={categoryFilter}
      onCategoryFilter={setCategoryFilter}
      itemQuery={itemQuery}
      onItemQuery={setItemQuery}
      catalogRows={catalogRows}
      catalogLoading={items.isPending}
      catalogPagination={{
        hasMore: Boolean(items.hasNextPage),
        loading: items.isFetchingNextPage,
        error: items.isFetchNextPageError ? t(errorKey(items.error)) : undefined,
        onLoadMore: () => void items.fetchNextPage(),
      }}
      onAddCatalogItem={addCatalogLine}
      manualOpen={manualOpen}
      onToggleManual={() => setManualOpen((v) => !v)}
      manualKind={manualKind}
      onManualKind={setManualKind}
      manualName={manualName}
      onManualName={setManualName}
      manualPrice={manualPrice}
      onManualPrice={(raw) => setManualPrice(parseAmountInput(raw))}
      manualSaveToCatalog={manualSaveToCatalog}
      onManualSaveToCatalog={() => setManualSaveToCatalog((v) => !v)}
      onAddManual={addManualLine}
      manualError={manualError}
      lines={lines}
      canOverridePrice={canOverridePrice}
      employees={employees}
      onLineQuantity={(key, quantity) => updateLine(key, { quantity: Math.max(1, quantity) })}
      onLinePrice={(key, raw) => updateLine(key, { unitPrice: parseAmountInput(raw) })}
      onLineEmployee={(key, employeeId) => updateLine(key, { employeeId })}
      onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
      discount={discount}
      onDiscount={(raw) => setDiscount(parseAmountInput(raw))}
      tip={tip}
      onTip={(raw) => setTip(parseAmountInput(raw))}
      payments={payments}
      onPaymentMethod={(key, method) => setPayments((prev) => prev.map((p) => (p.key === key ? { ...p, method, receivedAmount: method === 'cash' ? p.receivedAmount : null } : p)))}
      onPaymentAmount={(key, raw) => setPayments((prev) => prev.map((p) => (p.key === key ? { ...p, amount: parseAmountInput(raw) } : p)))}
      onPaymentReceived={(key, raw) => setPayments((prev) => prev.map((p) => (p.key === key ? { ...p, receivedAmount: raw.trim() === '' ? null : parseAmountInput(raw) } : p)))}
      onAddPayment={addPayment}
      onRemovePayment={(key) => setPayments((prev) => prev.filter((p) => p.key !== key))}
      subtotal={subtotal}
      total={total}
      changeDue={changeDue(payments)}
      remaining={remainingToPay(total, payments)}
      error={error}
      busy={busy}
      onSubmit={() => void submit()}
      onCancel={close}
      result={result}
      onWhatsapp={sendWhatsapp}
      onDownloadPdf={downloadPdf}
      onPosTicket={downloadPosTicket}
      onPrint={printReceipt}
      onNewSale={resetAll}
    />
    </Screen>
  );
}
