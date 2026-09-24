/**
 * Ruta /subscription SOLO WEB (nativo: subscription.tsx, con RevenueCat — sin cambios). Checkout con el sistema
 * de diseño propio de la Web (xw-*): tarjeta vía Stripe, PayPal y transferencia bancaria — los 3 métodos que ya
 * implementa el backend. Presentación en src/web/screens/Subscription.tsx.
 */
import { SUBSCRIPTION_PLANS, type SubscriptionPlan } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { useInvalidateSubscription, useSubscription } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { SubscriptionView, type CheckoutPaymentMethod, type CheckoutResult } from '@/web/screens/Subscription';
import { useWebText } from '@/web/services/useWebText';

export default function SubscriptionWeb() {
  const { t } = useWebText();
  const router = useRouter();
  const { business } = useAuthed();
  const { data: subscription } = useSubscription();
  const invalidateSubscription = useInvalidateSubscription();
  const { plan: requestedPlan } = useLocalSearchParams<{ plan?: string }>();
  const initialPlan = (SUBSCRIPTION_PLANS as readonly string[]).includes(requestedPlan ?? '') ? (requestedPlan as SubscriptionPlan) : undefined;

  async function checkout(plan: SubscriptionPlan, method: CheckoutPaymentMethod): Promise<CheckoutResult> {
    try {
      if (method === 'bank_transfer') return { instructions: (await api.checkoutBankTransfer(plan)).instructions };
      const { url } = method === 'paypal' ? await api.checkoutPaypal(plan) : await api.checkoutStripe(plan);
      return { url };
    } catch (e) {
      const notConfigured = e instanceof ApiError && e.code.endsWith('_not_configured');
      return { error: notConfigured ? t('subscription_method_unavailable') : t('subscription_purchase_error') };
    }
  }

  async function skipTrial(plan: SubscriptionPlan): Promise<{ ok: true } | { error: string }> {
    try {
      await api.startTrial(plan, 'web');
      await invalidateSubscription();
      router.replace('/');
      return { ok: true };
    } catch {
      return { error: t('subscription_trial_error') };
    }
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SubscriptionView t={t} currency={business.currency} subscription={subscription} initialPlan={initialPlan} onCheckout={checkout} onSkipTrial={skipTrial} onClose={close} />
  );
}
