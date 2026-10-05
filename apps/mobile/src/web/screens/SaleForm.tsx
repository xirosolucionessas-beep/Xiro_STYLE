import { formatMoney, type Currency, type SaleDto } from '@xiro/shared';
import type { ReactNode } from 'react';
import type { CartLine, PaymentRow } from '../../lib/sale';
import { formatAmountInput } from '../money';
import { BancolombiaBadge, NequiBadge } from '../brand/logos';
import { Ico } from '../icons';
import { Button, Input, Select } from '../ui';
import { RadioGroup } from '../ui/auth';
import { Avatar, EmptyPanel, FilterChips, SearchField } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface SaleClientResult {
  id: string;
  name: string;
  phone: string | null;
}
export interface SaleAppointmentHint {
  time: string;
  items: string;
}
export interface SaleCatalogRow {
  id: string;
  name: string;
  price: number;
  /** null = servicio (sin existencias que controlar). */
  stock: number | null;
  categoryId: string;
}
export interface SaleCategoryOption {
  id: string;
  name: string;
}
export interface SaleEmployeeOption {
  id: string;
  name: string;
}

const money = (amount: number, currency: Currency) => formatMoney(amount, currency);
const amountValue = (n: number) => (n === 0 ? '' : formatAmountInput(String(n)));

export interface SaleFormViewProps {
  t: T;
  currency: Currency;

  // Cliente
  clientQuery: string;
  onClientQuery: (value: string) => void;
  clientResults: SaleClientResult[];
  clientSearchLoading: boolean;
  selectedClient: { id: string; name: string } | null;
  occasional: boolean;
  onSelectClient: (client: SaleClientResult) => void;
  onOccasional: () => void;
  onChangeClient: () => void;
  newClientOpen: boolean;
  onToggleNewClient: () => void;
  newClientName: string;
  onNewClientName: (v: string) => void;
  newClientPhone: string;
  onNewClientPhone: (v: string) => void;
  onSaveNewClient: () => void;
  newClientBusy: boolean;
  newClientError?: string;
  appointmentHint: SaleAppointmentHint | null;
  appointmentLoaded: boolean;
  onLoadAppointment: () => void;

  // Catálogo y líneas
  tab: 'service' | 'product';
  onTab: (tab: 'service' | 'product') => void;
  categories: SaleCategoryOption[];
  categoryFilter: string | null;
  onCategoryFilter: (id: string | null) => void;
  itemQuery: string;
  onItemQuery: (v: string) => void;
  catalogRows: SaleCatalogRow[];
  onAddCatalogItem: (row: SaleCatalogRow) => void;
  manualOpen: boolean;
  onToggleManual: () => void;
  manualKind: 'service' | 'product';
  onManualKind: (k: 'service' | 'product') => void;
  manualName: string;
  onManualName: (v: string) => void;
  manualPrice: number;
  onManualPrice: (raw: string) => void;
  manualSaveToCatalog: boolean;
  onManualSaveToCatalog: () => void;
  onAddManual: () => void;
  manualError?: string;

  // Carrito
  lines: CartLine[];
  canOverridePrice: boolean;
  employees: SaleEmployeeOption[];
  onLineQuantity: (key: string, quantity: number) => void;
  onLinePrice: (key: string, raw: string) => void;
  onLineEmployee: (key: string, employeeId: string) => void;
  onRemoveLine: (key: string) => void;

  // Descuento, propina, pagos
  discount: number;
  onDiscount: (raw: string) => void;
  tip: number;
  onTip: (raw: string) => void;
  payments: PaymentRow[];
  onPaymentMethod: (key: string, method: PaymentRow['method']) => void;
  onPaymentAmount: (key: string, raw: string) => void;
  onPaymentReceived: (key: string, raw: string) => void;
  onAddPayment: () => void;
  onRemovePayment: (key: string) => void;

  // Totales y envío
  subtotal: number;
  total: number;
  changeDue: number;
  remaining: number;
  error?: string;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;

  // Confirmación
  result: (SaleDto & { rewardJustEarned?: boolean }) | null;
  onWhatsapp: () => void;
  onDownloadPdf: () => void;
  onPosTicket: () => void;
  onPrint: () => void;
  onNewSale: () => void;
}

const PAYMENT_METHODS: PaymentRow['method'][] = ['cash', 'card', 'nequi', 'bank_transfer', 'other'];
/** Ícono o logo oficial de cada forma de pago: Nequi y Bancolombia como marca propia (assets locales, sin enlaces
 * externos); el resto con el set de íconos de línea que ya usa el resto de la app. */
const PAYMENT_ICON: Record<PaymentRow['method'], (size: number) => ReactNode> = {
  cash: (size) => <Ico name="coins" size={size} />,
  card: (size) => <Ico name="credit-card" size={size} />,
  nequi: (size) => <NequiBadge size={size} />,
  bank_transfer: (size) => <BancolombiaBadge size={size} />,
  other: (size) => <Ico name="wallet" size={size} />,
};

export function SaleFormView(props: SaleFormViewProps) {
  useWebStyles();
  const { t, currency } = props;

  if (props.result) return <SaleDoneView {...props} result={props.result} />;

  return (
    <div className="xw-section xw-sale">
      {/* ---------- Cliente ---------- */}
      <section className="xw-panel">
        <header className="xw-panel-head">
          <h2 className="xw-panel-title">{t('sale_client_title')}</h2>
        </header>

        {props.selectedClient || props.occasional ? (
          <div className="xw-sale-client-picked">
            <Avatar name={props.selectedClient?.name ?? t('sale_client_occasional')} />
            <div className="xw-cell-text">
              <span className="xw-cell-title">{props.selectedClient?.name ?? t('sale_client_occasional')}</span>
              {props.occasional && !props.selectedClient ? <span className="xw-cell-sub">{t('sale_client_occasional_hint')}</span> : null}
            </div>
            <button type="button" className="xw-btn xw-btn--secondary xw-btn--sm" onClick={props.onChangeClient}>
              {t('sale_client_change')}
            </button>
          </div>
        ) : (
          <>
            <SearchField label={t('sale_client_search_label')} value={props.clientQuery} onChange={props.onClientQuery} />
            <div className="xw-sale-client-actions">
              <button type="button" className="xw-btn xw-btn--secondary xw-btn--sm" onClick={props.onOccasional}>
                <Ico name="user" size={16} />
                {t('sale_client_occasional')}
              </button>
              <button type="button" className="xw-btn xw-btn--secondary xw-btn--sm" onClick={props.onToggleNewClient} aria-expanded={props.newClientOpen}>
                <Ico name="plus" size={16} />
                {t('sale_client_new')}
              </button>
            </div>

            {props.newClientOpen ? (
              <div className="xw-sale-inline-form">
                <Input label={t('sale_client_new_name')} value={props.newClientName} onChange={props.onNewClientName} />
                <Input label={t('sale_client_new_phone')} value={props.newClientPhone} onChange={props.onNewClientPhone} inputMode="tel" />
                {props.newClientError ? (
                  <p className="xw-error" role="alert">
                    {props.newClientError}
                  </p>
                ) : null}
                <Button size="sm" loading={props.newClientBusy} loadingLabel={t('loading')} onPress={props.onSaveNewClient}>
                  {t('sale_client_new_save')}
                </Button>
              </div>
            ) : null}

            {props.clientQuery.trim().length >= 2 ? (
              props.clientResults.length > 0 ? (
                <ul className="xw-sale-client-results">
                  {props.clientResults.map((client) => (
                    <li key={client.id}>
                      <button type="button" className="xw-sale-client-row" onClick={() => props.onSelectClient(client)}>
                        <Avatar name={client.name} size={36} />
                        <span className="xw-cell-text">
                          <span className="xw-cell-title">{client.name}</span>
                          {client.phone ? <span className="xw-cell-sub">{client.phone}</span> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : !props.clientSearchLoading ? (
                <p className="xw-hint">{t('sale_client_no_results')}</p>
              ) : null
            ) : null}
          </>
        )}

        {props.appointmentHint ? (
          <div className="xw-sale-appt-hint">
            <Ico name="calendar-days" size={18} />
            <span className="xw-cell-text">
              <span>{t('sale_client_appt_hint', { time: props.appointmentHint.time, items: props.appointmentHint.items })}</span>
              {props.appointmentLoaded ? <span className="xw-cell-sub">{t('sale_client_appt_loaded')}</span> : null}
            </span>
            {!props.appointmentLoaded ? (
              <button type="button" className="xw-btn xw-btn--secondary xw-btn--sm" onClick={props.onLoadAppointment}>
                {t('sale_client_appt_load')}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ---------- Catálogo ---------- */}
      <section className="xw-panel">
        <header className="xw-panel-head">
          <h2 className="xw-panel-title">{t('sale_items_title')}</h2>
        </header>

        <div className="xw-sale-tabs" role="tablist" aria-label={t('sale_items_title')}>
          <button type="button" role="tab" aria-selected={props.tab === 'service'} className={`xw-sale-tab${props.tab === 'service' ? ' is-active' : ''}`} onClick={() => props.onTab('service')}>
            {t('sale_items_tab_services')}
          </button>
          <button type="button" role="tab" aria-selected={props.tab === 'product'} className={`xw-sale-tab${props.tab === 'product' ? ' is-active' : ''}`} onClick={() => props.onTab('product')}>
            {t('sale_items_tab_products')}
          </button>
        </div>

        <div className="xw-toolbar">
          <SearchField label={t('sale_items_search_label')} value={props.itemQuery} onChange={props.onItemQuery} />
          {props.categories.length > 0 ? (
            <FilterChips label={t('sale_items_all_categories')} value={props.categoryFilter} onChange={props.onCategoryFilter} options={props.categories.map((c) => ({ id: c.id, label: c.name }))} />
          ) : null}
        </div>

        {props.catalogRows.length === 0 ? (
          <EmptyPanel icon="search" title={t(props.tab === 'service' ? 'sale_items_empty_services' : 'sale_items_empty_products')} />
        ) : (
          <ul className="xw-sale-catalog">
            {props.catalogRows.map((row) => {
              const outOfStock = row.stock !== null && row.stock <= 0;
              return (
                <li key={row.id} className="xw-sale-catalog-row">
                  <span className="xw-cell-text">
                    <span className="xw-cell-title">{row.name}</span>
                    <span className="xw-cell-sub">{`${money(row.price, currency)}${row.stock !== null ? ` · ${outOfStock ? t('sale_items_out_of_stock') : t('sale_items_stock_units', { n: row.stock })}` : ''}`}</span>
                  </span>
                  <button type="button" className="xw-btn xw-btn--secondary xw-btn--sm" disabled={outOfStock} onClick={() => props.onAddCatalogItem(row)}>
                    <Ico name="plus" size={16} />
                    {t('sale_items_add')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <button type="button" className="xw-sale-manual-toggle" onClick={props.onToggleManual} aria-expanded={props.manualOpen}>
          <Ico name={props.manualOpen ? 'chevron-down' : 'plus'} size={16} />
          {t('sale_items_manual_add')}
        </button>

        {props.manualOpen ? (
          <div className="xw-sale-inline-form">
            <div className="xw-sale-tabs" role="radiogroup" aria-label={t('sale_manual_kind')}>
              <button type="button" role="radio" aria-checked={props.manualKind === 'service'} className={`xw-sale-tab${props.manualKind === 'service' ? ' is-active' : ''}`} onClick={() => props.onManualKind('service')}>
                {t('sale_items_tab_services')}
              </button>
              <button type="button" role="radio" aria-checked={props.manualKind === 'product'} className={`xw-sale-tab${props.manualKind === 'product' ? ' is-active' : ''}`} onClick={() => props.onManualKind('product')}>
                {t('sale_items_tab_products')}
              </button>
            </div>
            <Input label={t('sale_manual_name')} value={props.manualName} onChange={props.onManualName} />
            <Input label={t('sale_manual_price')} value={amountValue(props.manualPrice)} onChange={props.onManualPrice} inputMode="numeric" prefix={currency} />
            <label className="xw-sale-check">
              <input type="checkbox" checked={props.manualSaveToCatalog} onChange={props.onManualSaveToCatalog} />
              {t('sale_manual_save_to_catalog')}
            </label>
            {props.manualError ? (
              <p className="xw-error" role="alert">
                {props.manualError}
              </p>
            ) : null}
            <div className="xw-sale-inline-actions">
              <Button size="sm" onPress={props.onAddManual}>
                {t('sale_manual_add_cta')}
              </Button>
              <Button size="sm" variant="ghost" onPress={props.onToggleManual}>
                {t('sale_manual_cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      {/* ---------- Carrito ---------- */}
      <section className="xw-panel">
        <header className="xw-panel-head">
          <h2 className="xw-panel-title">{t('sale_cart_title')}</h2>
        </header>
        {props.lines.length === 0 ? (
          <p className="xw-hint">{t('sale_cart_empty')}</p>
        ) : (
          <ul className="xw-sale-cart">
            {props.lines.map((line) => {
              const overStock = line.kind === 'product' && line.stock !== null && line.quantity > line.stock;
              const editablePrice = line.itemId !== null && props.canOverridePrice;
              return (
                <li key={line.key} className="xw-sale-cart-row">
                  <div className="xw-sale-cart-top">
                    <span className="xw-cell-title">{line.name}</span>
                    <button type="button" className="xw-icon-btn" aria-label={t('sale_cart_remove')} onClick={() => props.onRemoveLine(line.key)}>
                      <Ico name="x" size={18} />
                    </button>
                  </div>
                  <div className="xw-sale-cart-controls">
                    <div className="xw-sale-stepper" role="group" aria-label={t('sale_cart_qty')}>
                      <button type="button" className="xw-icon-btn" aria-label="-" disabled={line.quantity <= 1} onClick={() => props.onLineQuantity(line.key, line.quantity - 1)}>
                        <Ico name="minus" size={16} />
                      </button>
                      <span aria-live="polite">{line.quantity}</span>
                      <button type="button" className="xw-icon-btn" aria-label="+" onClick={() => props.onLineQuantity(line.key, line.quantity + 1)}>
                        <Ico name="plus" size={16} />
                      </button>
                    </div>

                    {editablePrice ? (
                      <Input label={t('sale_cart_price_override')} hint={t('sale_cart_price_override_hint')} value={amountValue(line.unitPrice)} onChange={(raw) => props.onLinePrice(line.key, raw)} inputMode="numeric" prefix={currency} />
                    ) : (
                      <span className="xw-sale-cart-price">{money(line.unitPrice, currency)}</span>
                    )}

                    {line.kind === 'service' ? (
                      <Select label={t('sale_cart_employee')} value={line.employeeId ?? ''} onChange={(v) => props.onLineEmployee(line.key, v)} options={props.employees.map((e) => ({ value: e.id, label: e.name }))} />
                    ) : null}
                  </div>
                  {overStock ? <p className="xw-error">{t('sale_cart_insufficient_stock', { n: line.stock ?? 0 })}</p> : null}
                  <p className="xw-sale-cart-total">{money(line.unitPrice * line.quantity, currency)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------- Descuento, propina y pago ---------- */}
      <section className="xw-panel">
        <div className="xw-sale-discount-row">
          <Input label={t('sale_discount')} value={amountValue(props.discount)} onChange={props.onDiscount} inputMode="numeric" prefix={currency} />
          <Input label={t('sale_tip')} value={amountValue(props.tip)} onChange={props.onTip} inputMode="numeric" prefix={currency} />
        </div>

        <header className="xw-panel-head">
          <h2 className="xw-panel-title">{t('sale_pay_title')}</h2>
        </header>
        <ul className="xw-sale-payments">
          {props.payments.map((payment, index) => (
            <li key={payment.key} className="xw-sale-payment-row">
              <RadioGroup
                label={props.payments.length > 1 ? `${t('sale_pay_title')} ${index + 1}` : t('sale_pay_title')}
                hideLabel
                name={`payment-method-${payment.key}`}
                value={payment.method}
                onChange={(v) => props.onPaymentMethod(payment.key, v)}
                options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`sale_pay_${m}`), icon: PAYMENT_ICON[m](20) }))}
              />
              <Input label={t('sale_summary_total')} value={amountValue(payment.amount)} onChange={(raw) => props.onPaymentAmount(payment.key, raw)} inputMode="numeric" prefix={currency} />
              {payment.method === 'cash' ? <Input label={t('sale_pay_received')} value={payment.receivedAmount === null ? '' : amountValue(payment.receivedAmount)} onChange={(raw) => props.onPaymentReceived(payment.key, raw)} inputMode="numeric" prefix={currency} /> : null}
              {props.payments.length > 1 ? (
                <button type="button" className="xw-icon-btn" aria-label={t('sale_pay_remove')} onClick={() => props.onRemovePayment(payment.key)}>
                  <Ico name="x" size={18} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <button type="button" className="xw-sale-manual-toggle" onClick={props.onAddPayment}>
          <Ico name="plus" size={16} />
          {t('sale_pay_add')}
        </button>

        {props.remaining > 0 ? <p className="xw-hint">{t('sale_pay_remaining', { amount: money(props.remaining, currency) })}</p> : null}
        {props.remaining < 0 ? <p className="xw-error">{t('sale_pay_over', { amount: money(-props.remaining, currency) })}</p> : null}
        {props.remaining === 0 && props.total > 0 ? <p className="xw-hint">{t('sale_pay_complete')}</p> : null}
        {props.changeDue > 0 ? <p className="xw-hint">{t('sale_pay_change')}: {money(props.changeDue, currency)}</p> : null}
      </section>

      {/* ---------- Resumen y envío ---------- */}
      <div className="xw-sale-summary">
        <dl className="xw-summary">
          <div className="xw-summary-row">
            <dt>{t('sale_summary_subtotal')}</dt>
            <dd>{money(props.subtotal, currency)}</dd>
          </div>
          {props.discount > 0 ? (
            <div className="xw-summary-row">
              <dt>{t('sale_summary_discount')}</dt>
              <dd>-{money(props.discount, currency)}</dd>
            </div>
          ) : null}
          {props.tip > 0 ? (
            <div className="xw-summary-row">
              <dt>{t('sale_summary_tip')}</dt>
              <dd>{money(props.tip, currency)}</dd>
            </div>
          ) : null}
          <div className="xw-summary-row xw-summary-row--total">
            <dt>{t('sale_summary_total')}</dt>
            <dd>{money(props.total, currency)}</dd>
          </div>
        </dl>
        {props.error ? (
          <p className="xw-error" role="alert">
            {props.error}
          </p>
        ) : null}
        <div className="xw-sale-actions">
          <Button variant="ghost" onPress={props.onCancel} disabled={props.busy}>
            {t('sale_cancel_cta')}
          </Button>
          <Button fullWidth loading={props.busy} loadingLabel={t('loading')} onPress={props.onSubmit}>
            {t('sale_submit_cta')} · {money(props.total, currency)}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Confeti sutil alrededor del check de confirmación: menos denso que el de la celebración del plan (esto pasa varias
 * veces al día, no una sola vez en la vida de la cuenta). `@media (prefers-reduced-motion: reduce)` ya lo apaga de
 * forma global (ver styles.ts), así que no hace falta repetir esa condición aquí. */
const SALE_CONFETTI = Array.from({ length: 6 }, (_, i) => ({ left: `${10 + i * 15}%`, delay: `${(i % 3) * 0.12}s`, drift: i % 2 === 0 ? '14px' : '-12px' }));

function SaleDoneView({ t, currency, result, onWhatsapp, onDownloadPdf, onPosTicket, onPrint, onNewSale, onCancel }: SaleFormViewProps & { result: NonNullable<SaleFormViewProps['result']> }) {
  return (
    <div className="xw-section xw-sale-done">
      <div className="xw-empty">
        <span className="xw-empty-ic xw-sale-done-icon" aria-hidden="true">
          <span className="xw-celebrate-confetti">
            {SALE_CONFETTI.map((dot, i) => (
              <span key={i} className="xw-celebrate-dot" style={{ left: dot.left, animationDelay: dot.delay, ['--xw-drift' as string]: dot.drift }} />
            ))}
          </span>
          <Ico name="circle-check" size={40} />
        </span>
        <h2 className="xw-empty-title">{t('sale_done_title')}</h2>
        {result.rewardJustEarned ? <p className="xw-empty-text">{t('sale_done_reward')}</p> : null}
      </div>

      <dl className="xw-summary" id="xw-sale-receipt">
        <div className="xw-summary-row">
          <dt>{t('sale_done_total')}</dt>
          <dd>{money(result.total, currency)}</dd>
        </div>
        {result.changeGiven > 0 ? (
          <div className="xw-summary-row">
            <dt>{t('sale_done_change')}</dt>
            <dd>{money(result.changeGiven, currency)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="xw-sale-actions">
        <Button variant="secondary" icon={<Ico name="send" size={18} />} onPress={onWhatsapp}>
          {t('sale_done_whatsapp')}
        </Button>
        <Button variant="secondary" icon={<Ico name="download" size={18} />} onPress={onDownloadPdf}>
          {t('sale_done_download_pdf')}
        </Button>
        <Button variant="secondary" icon={<Ico name="store" size={18} />} onPress={onPosTicket}>
          {t('sale_done_pos_ticket')}
        </Button>
        <Button variant="secondary" icon={<Ico name="receipt" size={18} />} onPress={onPrint}>
          {t('sale_done_print')}
        </Button>
      </div>
      <div className="xw-sale-actions">
        <Button variant="ghost" onPress={onCancel}>
          {t('sale_done_close')}
        </Button>
        <Button fullWidth onPress={onNewSale}>
          {t('sale_done_new')}
        </Button>
      </div>
    </div>
  );
}
