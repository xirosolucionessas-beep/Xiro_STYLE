import type { SalePaymentMethod } from '@xiro/shared';
import type { BreakdownLineView, BreakdownView } from '@/lib/cashBreakdown';
import type { CashDetailTarget } from '@/lib/useCashDetail';
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
  /** 0–1: proporción para la barra animada bajo la fila (forma de pago: del total; ranking: del primero). Sin ella, sin barra. */
  share?: number;
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
  /** "Cerrado por Ana el 19 oct a las 6:40 p. m." (quién y cuándo firmó). Si falta, solo el nombre. */
  closedByLine?: string;
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
  /** Desglose por empleado (bruto, descuento repartido, neto); null = el servidor no lo envió (se muestra la lista anterior). */
  breakdown?: BreakdownView | null;
  /** Estado de la actualización automática ("Actualizado a las…", error con datos, pausa, día pasado). */
  live?: { text: string; problem: boolean } | null;
  /** "Ver más" de un empleado o de lo sin atribuir (abre el detalle de ventas). */
  onSeeMore?: (target: CashDetailTarget) => void;
  /** "Ver más" de los gastos del día. */
  onSeeMoreExpenses?: () => void;
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
      {props.live ? (
        <p className={cx('xw-hint', props.live.problem && 'is-danger')} role="status" aria-live="polite">
          <Ico name={props.live.problem ? 'info' : 'clock'} size={16} /> {props.live.text}{' '}
          {props.live.problem ? (
            <button type="button" className="xw-sale-manual-toggle" onClick={props.onRetry}>
              {t('retry')}
            </button>
          ) : null}
        </p>
      ) : null}

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
          <p className="xw-hint">{props.closed.closedByLine ?? t('cash_close_closed_by', { name: props.closed.closedByName })}</p>
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
            <ul className="xw-bars xw-cash-bars" aria-label={t('cash_close_hourly_chart')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {props.bars.map((bar, index) => (
                // --i escalona la animación de entrada (cascada de izquierda a derecha); la hora pico se resalta.
                <li key={bar.key} className={cx('xw-bar', bar.empty && 'is-empty', !bar.empty && bar.height >= 1 && 'is-peak')} style={{ ['--i' as string]: index }}>
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
            <RankList rows={props.paymentRows} />
          ) : null}
        </Panel>

        <Panel title={t('cash_close_top_services')} icon="scissors">
          {props.topServices.length === 0 ? <p className="xw-panel-empty">{t('cash_close_no_sales')}</p> : null}
          {props.topServices.length > 0 ? (
            <RankList rows={props.topServices} />
          ) : null}
        </Panel>

        <Panel title={t('cash_close_top_products')} icon="package">
          {props.topProducts.length === 0 ? <p className="xw-panel-empty">{t('cash_close_no_sales')}</p> : null}
          {props.topProducts.length > 0 ? (
            <RankList rows={props.topProducts} />
          ) : null}
        </Panel>

        {props.breakdown ? <BreakdownPanel t={t} view={props.breakdown} onSeeMore={props.onSeeMore} /> : null}

        {!props.breakdown && props.employeeRows.length > 0 ? (
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
          {props.onSeeMoreExpenses ? (
            <Button size="sm" variant="secondary" onPress={props.onSeeMoreExpenses} aria-label={t('cash_detail_see_more_expenses')}>
              {t('cash_detail_see_more')}
            </Button>
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

function BreakdownLines({ title, lines }: { title: string; lines: BreakdownLineView[] }) {
  if (lines.length === 0) return null;
  return (
    <>
      <p className="xw-cell-sub">{title}</p>
      {/* Lista propia (no xw-rank): nombre y neto en la primera fila, detalle debajo a todo el ancho. */}
      <ul className="xw-cash-lines">
        {lines.map((line) => (
          <li key={line.key}>
            <span className="xw-cash-line-name">{line.label}</span>
            <span className="xw-cash-line-net">{line.net}</span>
            <span className="xw-cash-line-detail">{line.detail}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Amounts({ t, gross, discount, net }: { t: T; gross: string; discount: string; net: string }) {
  return (
    <dl className="xw-summary">
      <div className="xw-summary-row">
        <dt>{t('cash_close_breakdown_gross')}</dt>
        <dd>{gross}</dd>
      </div>
      <div className="xw-summary-row">
        <dt>{t('cash_close_breakdown_discount')}</dt>
        <dd>{discount}</dd>
      </div>
      <div className="xw-summary-row xw-summary-row--total">
        <dt>{t('cash_close_breakdown_net')}</dt>
        <dd>{net}</dd>
      </div>
    </dl>
  );
}

/** Producción por empleado (quien REALIZÓ cada servicio), con "Sin atribución" para productos y servicios sin profesional. */
function BreakdownPanel({ t, view, onSeeMore }: { t: T; view: BreakdownView; onSeeMore?: (target: CashDetailTarget) => void }) {
  return (
    <Panel title={t('cash_close_breakdown_title')} icon="briefcase" className="xw-span-all">
      <p className="xw-hint">{t('cash_close_breakdown_intro')}</p>
      {view.empty ? <p className="xw-panel-empty">{t('cash_close_breakdown_empty')}</p> : null}
      {/* Cuadrícula según el ancho REAL del panel (auto-fill), no el de la página: tarjetas de ancho razonable. */}
      <div className="xw-cash-cards">
        {view.employees.map((e, index) => (
          <section key={e.id} className="xw-panel xw-cash-card" aria-label={e.name}>
            <h3 className="xw-panel-title">
              {e.name} <span className="xw-cell-sub">· {e.units}</span>
            </h3>
            <ShareBar share={e.share} index={index} />
            <Amounts t={t} gross={e.gross} discount={e.discount} net={e.net} />
            <BreakdownLines title={t('cash_close_breakdown_services')} lines={e.lines} />
            {onSeeMore ? (
              <div className="xw-cash-card-action">
                <Button size="sm" variant="secondary" onPress={() => onSeeMore({ scope: 'employee', employeeId: e.id, name: e.name })} aria-label={t('cash_detail_see_more_employee', { name: e.name })}>
                  {t('cash_detail_see_more')}
                </Button>
              </div>
            ) : null}
          </section>
        ))}
        {view.unattributed ? (
          <section className="xw-panel xw-cash-card" aria-label={t('cash_close_breakdown_unattributed')}>
            <h3 className="xw-panel-title">{t('cash_close_breakdown_unattributed')}</h3>
            <Amounts t={t} gross={view.unattributed.gross} discount={view.unattributed.discount} net={view.unattributed.net} />
            <BreakdownLines title={t('cash_close_breakdown_unattributed_services')} lines={view.unattributed.services} />
            <BreakdownLines title={t('cash_close_breakdown_products')} lines={view.unattributed.products} />
            {view.unattributed.products.length > 0 ? <p className="xw-hint">{t('cash_close_breakdown_products_note')}</p> : null}
            {onSeeMore ? (
              <div className="xw-cash-card-action">
                <Button size="sm" variant="secondary" onPress={() => onSeeMore({ scope: 'unattributed' })} aria-label={t('cash_detail_see_more_unattributed')}>
                  {t('cash_detail_see_more')}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
      {!view.empty ? (
        <>
          <dl className="xw-summary">
            <div className="xw-summary-row">
              <dt>{t('cash_close_breakdown_tips')}</dt>
              <dd>{view.tips}</dd>
            </div>
          </dl>
          {view.hasTips ? <p className="xw-hint">{t('cash_close_breakdown_tips_note')}</p> : null}
          <p className="xw-hint">{view.reconcile}</p>
          <p className="xw-hint">{t('cash_close_breakdown_discount_rule')}</p>
        </>
      ) : null}
    </Panel>
  );
}

/** Barra de proporción animada (crece al aparecer y se ajusta suave cuando cambian los datos). Decorativa: el valor ya está en texto. */
function ShareBar({ share, index = 0 }: { share?: number; index?: number }) {
  if (share === undefined) return null;
  const clamped = Math.max(0, Math.min(1, share));
  return (
    <span className="xw-cash-share" aria-hidden="true" style={{ ['--i' as string]: index }}>
      <span className="xw-cash-share-fill" style={{ width: `${Math.max(clamped * 100, clamped > 0 ? 2 : 0)}%` }} />
    </span>
  );
}

function RankList({ rows }: { rows: CashCloseRankRow[] }) {
  return (
    <ol className="xw-rank xw-cash-rank">
      {rows.map((row, index) => (
        <li key={row.id}>
          <span className="xw-rank-name">{row.name}</span>
          <span className="xw-cell-sub">{row.sub}</span>
          <span className="xw-rank-val">{row.value}</span>
          <ShareBar share={row.share} index={index} />
        </li>
      ))}
    </ol>
  );
}
