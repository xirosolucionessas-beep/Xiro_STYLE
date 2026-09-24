import { formatMoney, SUBSCRIPTION_PRICING, TRIAL_DAYS, YEARLY_SAVINGS_PCT, type Currency, type Subscription, type SubscriptionPlan } from '@xiro/shared';
import { useState, type ReactNode } from 'react';
import { BancolombiaBadge, NequiBadge, PaypalLogo } from '../brand/logos';
import { Ico } from '../icons';
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

export function SubscriptionView({ t, currency, subscription, initialPlan, onCheckout, onSkipTrial, onClose }: SubscriptionViewProps) {
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

  return (
    <div className="xw-page xw-sub-page">
      {canClose ? (
        <button type="button" className="xw-sub-close" onClick={onClose} aria-label={t('close')}>
          <Ico name="x" size={20} />
        </button>
      ) : null}
      <div className="xw-sub-head">
        <h1 className="xw-h1">{t('subscription_title')}</h1>
        <p className="xw-sub">{t('subscription_subtitle')}</p>
      </div>

      {alreadyPremium ? (
        <div className="xw-note" style={{ marginBottom: 'var(--xw-space-6)' }}>
          <Ico name="check" />
          <span>
            {t('subscription_current_plan')}: <strong>{subscription?.plan === 'yearly' ? t('plan_yearly') : t('plan_monthly')}</strong>
          </span>
        </div>
      ) : null}

      <div className="xw-plans-grid" role="radiogroup" aria-label={t('subscription_title')}>
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

      <div className="xw-pay-methods" role="radiogroup" aria-label={t('subscription_payment_method')}>
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

      <p className="xw-hint" style={{ marginTop: 'var(--xw-space-6)', textAlign: 'center' }}>
        {method === 'bank_transfer' ? t('bank_transfer_note') : t('subscription_auto_renew_notice', { store: method === 'paypal' ? 'PayPal' : 'Stripe' })}
      </p>
    </div>
  );
}
