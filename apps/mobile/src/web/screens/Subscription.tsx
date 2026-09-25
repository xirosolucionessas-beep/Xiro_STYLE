import { formatMoney, SUBSCRIPTION_PRICING, TRIAL_DAYS, YEARLY_SAVINGS_PCT, type Currency, type Subscription, type SubscriptionPlan } from '@xiro/shared';
import { useState, type ReactNode } from 'react';
import { BancolombiaBadge, NequiBadge, PaypalLogo } from '../brand/logos';
import { Ico, type IconName } from '../icons';
import { Button } from '../ui';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;
export type CheckoutPaymentMethod = 'card' | 'paypal' | 'bank_transfer';
export type CheckoutResult = { url: string } | { instructions: string } | { error: string };

export interface SubscriptionViewProps {
  t: T;
  currency: Currency;
  subscription?: Subscription;
  initialPlan?: SubscriptionPlan;
  /** Logo del negocio (o el de la marca) para el panel de beneficios; decorativo. */
  logo?: ReactNode;
  onCheckout: (plan: SubscriptionPlan, method: CheckoutPaymentMethod) => Promise<CheckoutResult>;
  /** "Saltar por ahora": activa la prueba gratis sin pasar por ningún método de pago. Ausente ⇒ no se ofrece (p.ej. ya sin prueba disponible). */
  onSkipTrial?: (plan: SubscriptionPlan) => Promise<{ ok: true } | { error: string }>;
  /** Volver al Dashboard sin cambiar nada. Solo aplica a quien YA tiene/tuvo un plan (gestión desde Ajustes); en el
   * onboarding de una cuenta nueva no hay a dónde "volver" todavía, así que no se ofrece. */
  onClose?: () => void;
}

const METHODS: Array<{ id: CheckoutPaymentMethod; labelKey: string; hintKey?: string; icon: (props: { size: number }) => ReactNode }> = [
  { id: 'card', labelKey: 'pay_method_card', icon: ({ size }) => <Ico name="credit-card" size={size} /> },
  { id: 'paypal', labelKey: 'pay_method_paypal', icon: ({ size }) => <PaypalLogo size={size} /> },
  {
    id: 'bank_transfer',
    labelKey: 'pay_method_bank_transfer',
    hintKey: 'pay_method_bank_transfer_hint',
    icon: ({ size }) => (
      <span className="xw-pay-mini-badges">
        <NequiBadge size={size * 0.72} />
        <BancolombiaBadge size={size * 0.72} />
      </span>
    ),
  },
];

/** Lo que el plan desbloquea hoy en la app (solo módulos que existen: sin promesas de lo que aún no está). */
const BENEFITS: Array<{ icon: IconName; key: string }> = [
  { icon: 'users', key: 'sec_co_b1' },
  { icon: 'package', key: 'sec_co_b2' },
  { icon: 'wallet', key: 'sec_co_b3' },
  { icon: 'gift', key: 'sec_co_b4' },
  { icon: 'briefcase', key: 'sec_co_b5' },
  { icon: 'message-circle', key: 'sec_co_b6' },
];

export function SubscriptionView({ t, currency, subscription, initialPlan, logo, onCheckout, onSkipTrial, onClose }: SubscriptionViewProps) {
  useWebStyles();
  const [plan, setPlan] = useState<SubscriptionPlan>(initialPlan ?? 'yearly');
  const [method, setMethod] = useState<CheckoutPaymentMethod>('card');
  const [busy, setBusy] = useState<'submit' | 'skip' | null>(null);
  const [error, setError] = useState<string>();
  const [bankInstructions, setBankInstructions] = useState<string>();

  const trialEligible = subscription?.status === 'none';
  const alreadyPremium = Boolean(subscription?.hasAccess && subscription.status !== 'none');

  async function submit() {
    setBusy('submit');
    setError(undefined);
    setBankInstructions(undefined);
    const result = await onCheckout(plan, method);
    if ('error' in result) setError(result.error);
    else if ('instructions' in result) setBankInstructions(result.instructions);
    else {
      // Redirección real a un dominio externo (Stripe/PayPal): la navegación interna de la app no sale de sí misma.
      window.location.href = result.url;
      return; // se sale de la página: no hace falta apagar `busy`
    }
    setBusy(null);
  }

  async function skip() {
    if (!onSkipTrial) return;
    setBusy('skip');
    setError(undefined);
    setBankInstructions(undefined);
    const result = await onSkipTrial(plan);
    if ('error' in result) setError(result.error);
    setBusy(null);
  }

  const busyAny = busy !== null;
  const canClose = Boolean(onClose && subscription && subscription.status !== 'none');
  const period = t(plan === 'monthly' ? 'plan_period_month' : 'plan_period_year');

  return (
    <div className="xw-page xw-sub-page">
      {canClose ? (
        <button type="button" className="xw-sub-close" onClick={onClose} aria-label={t('close')}>
          <Ico name="x" size={20} />
        </button>
      ) : null}

      <div className="xw-co">
        {/* Región con scroll propio cuando no cabe en el alto: debe poder enfocarse con el teclado (axe: scrollable-region-focusable). */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <aside className="xw-co-aside xw-scope-dark" tabIndex={0} aria-label={t('sec_co_kicker')}>
          {logo ? (
            <span className="xw-co-logo" aria-hidden="true">
              {logo}
            </span>
          ) : null}
          <span className="xw-chip">
            <Ico name="crown" size={14} />
            &nbsp;{t('sec_co_kicker')}
          </span>
          <h1 className="xw-co-title">{t('subscription_title')}</h1>
          <p className="xw-co-sub">{t('subscription_subtitle')}</p>
          <ul className="xw-co-benefits">
            {BENEFITS.map((benefit) => (
              <li key={benefit.key}>
                <span className="xw-co-benefit-ic" aria-hidden="true">
                  <Ico name={benefit.icon} size={18} />
                </span>
                <span>{t(benefit.key)}</span>
              </li>
            ))}
          </ul>
          <p className="xw-co-trust">
            <Ico name="shield-check" size={16} />
            <span>{t('sec_co_trust')}</span>
          </p>
        </aside>

        <div className="xw-co-main">
          {alreadyPremium ? (
            <div className="xw-note">
              <Ico name="check" />
              <span>
                {t('subscription_current_plan')}: <strong>{subscription?.plan === 'yearly' ? t('plan_yearly') : t('plan_monthly')}</strong>
              </span>
            </div>
          ) : null}

          <section className="xw-co-step" aria-labelledby="xw-co-step1">
            <h2 id="xw-co-step1" className="xw-co-step-title">
              <span className="xw-co-step-n" aria-hidden="true">
                1
              </span>
              {t('sec_co_step1')}
            </h2>
            <div className="xw-plans-grid" role="radiogroup" aria-labelledby="xw-co-step1">
              {(['monthly', 'yearly'] as const).map((option) => {
                const selected = plan === option;
                return (
                  <button key={option} type="button" role="radio" aria-checked={selected} className={`xw-plan-card${selected ? ' is-selected' : ''}`} onClick={() => setPlan(option)}>
                    <div className="xw-plan-card-top">
                      <span>{t(option === 'monthly' ? 'plan_monthly' : 'plan_yearly')}</span>
                      {option === 'yearly' ? <span className="xw-plan-badge">{t('plan_yearly_savings', { pct: YEARLY_SAVINGS_PCT })}</span> : null}
                    </div>
                    <div className="xw-plan-price">
                      {formatMoney(SUBSCRIPTION_PRICING[option].amount, currency)} <span className="xw-plan-period">{t(option === 'monthly' ? 'plan_period_month' : 'plan_period_year')}</span>
                    </div>
                    {trialEligible ? <p className="xw-plan-trial">{t('trial_days_free', { days: TRIAL_DAYS })}</p> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="xw-co-step" aria-labelledby="xw-co-step2">
            <h2 id="xw-co-step2" className="xw-co-step-title">
              <span className="xw-co-step-n" aria-hidden="true">
                2
              </span>
              {t('sec_co_step2')}
            </h2>
            <div className="xw-pay-methods" role="radiogroup" aria-labelledby="xw-co-step2">
              {METHODS.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={method === m.id} className={`xw-pay-method${method === m.id ? ' is-selected' : ''}`} onClick={() => setMethod(m.id)}>
                  <span className="xw-pay-method-ico">{m.icon({ size: 26 })}</span>
                  <span className="xw-pay-method-text">
                    <span className="xw-pay-method-label">{t(m.labelKey)}</span>
                    {m.hintKey ? <span className="xw-pay-method-hint">{t(m.hintKey)}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="xw-co-summary" aria-label={t('sec_co_summary')}>
            <dl className="xw-summary">
              <div className="xw-summary-row">
                <dt>{t('sec_co_summary')}</dt>
                <dd>{t(plan === 'monthly' ? 'plan_monthly' : 'plan_yearly')}</dd>
              </div>
              <div className="xw-summary-row">
                <dt>{t('sec_co_price')}</dt>
                <dd>
                  {formatMoney(SUBSCRIPTION_PRICING[plan].amount, currency)} {period}
                </dd>
              </div>
              {trialEligible ? (
                <div className="xw-summary-row">
                  <dt>{t('sec_co_trial')}</dt>
                  <dd>{t('trial_days_free', { days: TRIAL_DAYS })}</dd>
                </div>
              ) : null}
            </dl>

            <Button fullWidth onPress={() => void submit()} disabled={busyAny} loading={busy === 'submit'} loadingLabel={t('loading')}>
              {method === 'bank_transfer' ? t('pay_method_bank_transfer_cta') : trialEligible ? t('subscribe_trial_cta') : t('subscribe_cta')}
            </Button>

            {onSkipTrial && trialEligible ? (
              <>
                <Button fullWidth variant="ghost" onPress={() => void skip()} disabled={busyAny} loading={busy === 'skip'} loadingLabel={t('loading')} style={{ marginTop: 'var(--xw-space-3)' }}>
                  {t('subscription_skip_cta', { days: TRIAL_DAYS })}
                </Button>
                <p className="xw-hint" style={{ marginTop: 'var(--xw-space-2)', textAlign: 'center' }}>
                  {t('subscription_skip_hint')}
                </p>
              </>
            ) : null}

            {error ? (
              <p className="xw-error" role="alert" style={{ marginTop: 'var(--xw-space-3)' }}>
                {error}
              </p>
            ) : null}
            {bankInstructions ? (
              <pre className="xw-bank-note" role="status">
                {bankInstructions}
              </pre>
            ) : null}

            <p className="xw-hint" style={{ marginTop: 'var(--xw-space-4)', textAlign: 'center' }}>
              {method === 'bank_transfer' ? t('bank_transfer_note') : t('subscription_auto_renew_notice', { store: method === 'paypal' ? 'PayPal' : 'Stripe' })}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
