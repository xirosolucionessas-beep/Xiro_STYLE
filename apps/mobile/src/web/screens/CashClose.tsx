import type { SalePaymentMethod } from '@xiro/shared';
import { formatAmountInput } from '../money';
import { Ico } from '../icons';
import { linkProps } from '../ui/link';
import { Badge, EmptyPanel, ErrorPanel, KpiRow, LoadingRows, Panel, type KpiView } from '../ui/Page';
import { Button, Input, Select } from '../ui';
import { cx, useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface CashCloseRankRow {
  id: string;
  name: string;
  value: string;
  sub: string;
}
export interface CashCloseBar {
  key: string;
  label: string;
  aria: string;
  height: number;
  value?: string;
  empty: boolean;
}
export interface CashCloseExpenseRow {
  id: string;
  description: string;
  amount: string;
  time: string;
}
export interface CashCloseHistoryRow {
  id: string;
  dayLabel: string;
  total: string;
  difference: string;
  status: 'completed' | 'voided';
  href: string;
}
export interface CashCloseClosedInfo {
  countedAmount: string;
  expectedAmount: string;
  difference: string;
  surplus: boolean;
  note: string;
  closedByName: string;
  status: 'completed' | 'voided';
  voidReason: string;
  /** "Después del cierre: ventas +$X · efectivo esperado +$Y…" (lib/cashFlow.ts); null si nada cambió después de firmar. */
  afterClose?: string | null;
}

const amountValue = (n: number) => (n === 0 ? '' : formatAmountInput(String(n)));
const PAYMENT_METHODS: SalePaymentMethod[] = ['cash', 'card', 'nequi', 'bank_transfer', 'other'];

export interface CashCloseViewProps {
  t: T;
  currency: string;
  dayLabel: string;
  isToday: boolean;
  todayHref: string;
  navigate: (href: string) => void;
  state: 'loading' | 'error' | 'ready';
  errorMessage?: string;
  onRetry: () => void;

  kpis: KpiView[];
  /** "Cobros sin venta registrada…" (lib/cashFlow.ts → unbilledNote); null si no hubo. Informativo: no toca el arqueo. */
  unbilledNote?: string | null;
  bars: CashCloseBar[];
  paymentRows: CashCloseRankRow[];
  topServices: CashCloseRankRow[];
  topProducts: CashCloseRankRow[];
  employeeRows: CashCloseRankRow[];
  expenseRows: CashCloseExpenseRow[];
  clientsServed: number;
  newClients: number;
  appointments: { completed: number; cancelled: number; noShow: number };

  closed: CashCloseClosedInfo | null;
  isOwner: boolean;

  canAct: boolean; // hoy y sin cerrar todavía
  expenseOpen: boolean;
  onToggleExpense: () => void;
  expenseAmount: number;
  onExpenseAmount: (raw: string) => void;
  expenseDescription: string;
  onExpenseDescription: (v: string) => void;
  expenseMethod: SalePaymentMethod;
  onExpenseMethod: (m: SalePaymentMethod) => void;
  onAddExpense: () => void;
  expenseBusy: boolean;
  expenseError?: string;

  hasOpening: boolean;
  countedAmount: number;
  onCountedAmount: (raw: string) => void;
  closeNote: string;
  onCloseNote: (v: string) => void;
  onSubmitClose: () => void;
  closeBusy: boolean;
  closeError?: string;
  expectedCashPreview: number | null;

  onOpenVoid: () => void;
  onWhatsapp: () => void;
  onPrint: () => void;

  history: CashCloseHistoryRow[];
}

export function CashCloseView(props: CashCloseViewProps) {
  useWebStyles();
  const { t } = props;

  if (props.state === 'loading') return <LoadingRows label={t('dash_loading')} rows={6} />;
  if (props.state === 'error') return <ErrorPanel message={props.errorMessage ?? t('unknown_error')} retryLabel={t('retry')} onRetry={props.onRetry} />;

  return (
    <div className="xw-section" id="xw-cash-receipt">
      <div className="xw-cash-close-head">
        <h2 className="xw-panel-title">{props.dayLabel}</h2>
        {!props.isToday ? (
          <a className="xw-btn xw-btn--secondary xw-btn--sm" {...linkProps(props.todayHref, props.navigate)}>
            {t('cash_close_go_today')}
          </a>
        ) : null}
      </div>

      {props.closed ? (
        <Panel title={t('cash_close_summary_title')} icon={props.closed.status === 'voided' ? 'x' : 'circle-check'}>
          <Badge tone={props.closed.status === 'voided' ? 'danger' : 'success'}>{t(props.closed.status === 'voided' ? 'cash_close_status_voided' : 'cash_close_status_completed')}</Badge>
          {props.closed.status === 'voided' && props.closed.voidReason ? <p className="xw-hint">{t('cash_close_void_reason_label', { reason: props.closed.voidReason })}</p> : null}
          <dl className="xw-summary">
            <div className="xw-summary-row">
              <dt>{t('cash_close_expected')}</dt>
              <dd>{props.closed.expectedAmount}</dd>
            </div>
            <div className="xw-summary-row">
              <dt>{t('cash_close_counted')}</dt>
              <dd>{props.closed.countedAmount}</dd>
            </div>
            <div className="xw-summary-row xw-summary-row--total">
              <dt>{t(props.closed.surplus ? 'cash_close_surplus' : 'cash_close_shortfall')}</dt>
              <dd className={cx(props.closed.surplus ? 'is-success' : 'is-danger')}>{props.closed.difference}</dd>
            </div>
          </dl>
          {props.closed.note ? <p className="xw-hint">{props.closed.note}</p> : null}
          {props.closed.status === 'completed' && props.closed.afterClose ? (
            <p className="xw-hint xw-after-close" role="note">
              <Ico name="info" size={16} /> {props.closed.afterClose}
            </p>
          ) : null}
          <p className="xw-hint">{t('cash_close_closed_by', { name: props.closed.closedByName })}</p>
          <div className="xw-sale-actions">
            <Button variant="secondary" icon={<Ico name="send" size={18} />} onPress={props.onWhatsapp}>
              {t('cash_close_whatsapp')}
            </Button>
            <Button variant="secondary" icon={<Ico name="receipt" size={18} />} onPress={props.onPrint}>
              {t('cash_close_print')}
            </Button>
            {props.isOwner && props.closed.status === 'completed' ? (
              <Button variant="danger" onPress={props.onOpenVoid}>
                {t('cash_close_void_action')}
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <KpiRow kpis={props.kpis} label={t('cash_close_kpis')} t={t} />
      {props.unbilledNote ? (
        <p className="xw-hint xw-after-close" role="note">
          <Ico name="info" size={16} /> {props.unbilledNote}
        </p>
      ) : null}

      {/* xw-panels--3 es un modificador de xw-panels (agrega una tercera columna en pantallas anchas, ver pagesCss.ts):
          con solo dos columnas, tarjetas cortas como "Clientes y citas" o "Gastos del día" quedaban junto a otras
          mucho más largas y dejaban un vacío grande debajo; en tres columnas cada tarjeta pesa menos frente a sus
          vecinas, así que el conjunto se ve denso y parejo, no incompleto. */}
      <div className="xw-panels xw-panels--3">
        <Panel title={t('cash_close_hourly_chart')} icon="bar-chart" className="xw-span-all">
          {props.bars.every((b) => b.empty) ? (
            <EmptyPanel icon="bar-chart" title={t('cash_close_no_sales')} />
          ) : (
            <ul className="xw-bars" aria-label={t('cash_close_hourly_chart')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {props.bars.map((bar) => (
                <li key={bar.key} className={cx('xw-bar', bar.empty && 'is-empty')}>
                  {bar.value ? <span className="xw-bar-value">{bar.value}</span> : null}
                  <span className="xw-bar-fill" style={{ height: `${Math.max(bar.height * 100, 2)}%` }} aria-hidden="true" />
                  <span className="xw-sr">{bar.aria}</span>
                  <span className="xw-bar-label" aria-hidden="true">
                    {bar.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t('cash_close_by_method')} icon="wallet">
          {props.paymentRows.length === 0 ? <p className="xw-panel-empty">{t('cash_close_no_sales')}</p> : null}
          {props.paymentRows.length > 0 ? (
            <ol className="xw-rank">
              {props.paymentRows.map((row) => (
                <li key={row.id}>
                  <span className="xw-rank-name">{row.name}</span>
                  <span className="xw-cell-sub">{row.sub}</span>
                  <span className="xw-rank-val">{row.value}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </Panel>

        <Panel title={t('cash_close_top_services')} icon="scissors">
          {props.topServices.length === 0 ? <p className="xw-panel-empty">{t('cash_close_no_sales')}</p> : null}
          {props.topServices.length > 0 ? (
            <ol className="xw-rank">
              {props.topServices.map((row) => (
                <li key={row.id}>
                  <span className="xw-rank-name">{row.name}</span>
                  <span className="xw-cell-sub">{row.sub}</span>
                  <span className="xw-rank-val">{row.value}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </Panel>

        <Panel title={t('cash_close_top_products')} icon="package">
          {props.topProducts.length === 0 ? <p className="xw-panel-empty">{t('cash_close_no_sales')}</p> : null}
          {props.topProducts.length > 0 ? (
            <ol className="xw-rank">
              {props.topProducts.map((row) => (
                <li key={row.id}>
                  <span className="xw-rank-name">{row.name}</span>
                  <span className="xw-cell-sub">{row.sub}</span>
                  <span className="xw-rank-val">{row.value}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </Panel>

        {props.employeeRows.length > 0 ? (
          <Panel title={t('cash_close_employees')} icon="briefcase">
            <ol className="xw-rank">
              {props.employeeRows.map((row) => (
                <li key={row.id}>
                  <span className="xw-rank-name">{row.name}</span>
                  <span className="xw-cell-sub">{row.sub}</span>
                  <span className="xw-rank-val">{row.value}</span>
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}

        <Panel title={t('cash_close_clients')} icon="users">
          <dl className="xw-summary">
            <div className="xw-summary-row">
              <dt>{t('cash_close_clients_served')}</dt>
              <dd>{props.clientsServed}</dd>
            </div>
            <div className="xw-summary-row">
              <dt>{t('cash_close_clients_new')}</dt>
              <dd>{props.newClients}</dd>
            </div>
            <div className="xw-summary-row">
              <dt>{t('cash_close_appts_completed')}</dt>
              <dd>{props.appointments.completed}</dd>
            </div>
            <div className="xw-summary-row">
              <dt>{t('cash_close_appts_cancelled')}</dt>
              <dd>{props.appointments.cancelled}</dd>
            </div>
            <div className="xw-summary-row">
              <dt>{t('cash_close_appts_no_show')}</dt>
              <dd>{props.appointments.noShow}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title={t('cash_close_expenses_title')} icon="receipt">
          {props.expenseRows.length === 0 ? <p className="xw-panel-empty">{t('cash_close_no_expenses')}</p> : null}
          {props.expenseRows.length > 0 ? (
            <ul className="xw-sale-cart" style={{ gap: 'var(--xw-space-2)' }}>
              {props.expenseRows.map((row) => (
                <li key={row.id} className="xw-sale-catalog-row">
                  <span className="xw-cell-text">
                    <span className="xw-cell-title">{row.description}</span>
                    <span className="xw-cell-sub">{row.time}</span>
                  </span>
                  <span className="xw-sale-cart-price">{row.amount}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {props.canAct ? (
            <>
              <button type="button" className="xw-sale-manual-toggle" onClick={props.onToggleExpense} aria-expanded={props.expenseOpen}>
                <Ico name={props.expenseOpen ? 'chevron-down' : 'plus'} size={16} />
                {t('cash_close_add_expense')}
              </button>
              {props.expenseOpen ? (
                <div className="xw-sale-inline-form">
                  <Input label={t('cash_close_expense_description')} value={props.expenseDescription} onChange={props.onExpenseDescription} />
                  <Input label={t('cash_close_expense_amount')} value={amountValue(props.expenseAmount)} onChange={props.onExpenseAmount} inputMode="numeric" prefix={props.currency} />
                  <Select label={t('sale_pay_title')} value={props.expenseMethod} onChange={(v) => props.onExpenseMethod(v as SalePaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`sale_pay_${m}`) }))} />
                  {props.expenseError ? (
                    <p className="xw-error" role="alert">
                      {props.expenseError}
                    </p>
                  ) : null}
                  <Button size="sm" loading={props.expenseBusy} loadingLabel={t('loading')} onPress={props.onAddExpense}>
                    {t('cash_close_add_expense_cta')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </Panel>
      </div>

      {props.canAct && props.isOwner ? (
        <Panel title={t('cash_close_close_title')} icon="wallet" className="xw-span-all">
          {!props.hasOpening ? (
            <p className="xw-hint">{t('cash_close_no_opening')}</p>
          ) : (
            <>
              <p className="xw-hint">{t('cash_close_expected_preview', { amount: props.expectedCashPreview !== null ? String(props.expectedCashPreview) : '—' })}</p>
              <Input label={t('cash_close_counted_label')} value={amountValue(props.countedAmount)} onChange={props.onCountedAmount} inputMode="numeric" prefix={props.currency} />
              <Input label={t('cash_close_note_label')} value={props.closeNote} onChange={props.onCloseNote} maxLength={500} />
              {props.closeError ? (
                <p className="xw-error" role="alert">
                  {props.closeError}
                </p>
              ) : null}
              <Button loading={props.closeBusy} loadingLabel={t('loading')} onPress={props.onSubmitClose}>
                {t('cash_close_submit_cta')}
              </Button>
            </>
          )}
        </Panel>
      ) : null}

      {props.history.length > 0 ? (
        <Panel title={t('cash_close_history_title')} icon="clock" className="xw-span-all">
          <ul className="xw-sale-cart" style={{ gap: 'var(--xw-space-2)' }}>
            {props.history.map((row) => (
              <li key={row.id} className="xw-sale-catalog-row">
                <a className="xw-cell-title" {...linkProps(row.href, props.navigate)}>
                  {row.dayLabel}
                </a>
                <span className="xw-cell-sub">{row.total}</span>
                <Badge tone={row.status === 'voided' ? 'danger' : 'muted'}>{t(row.status === 'voided' ? 'cash_close_status_voided' : 'cash_close_status_completed')}</Badge>
                <span className="xw-sale-cart-price">{row.difference}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
