/**
 * Ruta /subscription SOLO WEB (nativo: subscription.tsx, con RevenueCat — sin cambios). Checkout con el sistema
 * de diseño propio de la Web (xw-*): tarjeta vía Stripe, PayPal y transferencia bancaria — los 3 métodos que ya
 * implementa el backend. Presentación en src/web/screens/Subscription.tsx.
 */
import { SUBSCRIPTION_PLANS, type SubscriptionInvoiceDto, type SubscriptionPlan } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { useInvalidateSubscription, useSubscription, useSubscriptionInvoices } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { SubscriptionView, type CheckoutPaymentMethod, type CheckoutResult } from '@/web/screens/Subscription';
import { downloadSubscriptionInvoicePdf, downloadSubscriptionPosTicketPdf } from '@/web/services/subscriptionInvoicePdf';
import { useWebText } from '@/web/services/useWebText';

export default function SubscriptionWeb() {
  const { t, language } = useWebText();
  const router = useRouter();
  const { user, business } = useAuthed();
  const { data: subscription } = useSubscription();
  const invalidateSubscription = useInvalidateSubscription();
  // Un empleado no tiene permiso para esto (403): la pantalla ni la pide. Un dueño sin plan aún tampoco la necesita.
  const showInvoices = user.role === 'owner' && subscription && subscription.status !== 'none';
  const { data: invoices } = useSubscriptionInvoices(showInvoices);
  const { plan: requestedPlan } = useLocalSearchParams<{ plan?: string }>();
  const initialPlan = (SUBSCRIPTION_PLANS as readonly string[]).includes(requestedPlan ?? '') ? (requestedPlan as SubscriptionPlan) : undefined;

  const locale = language === 'en' ? 'en-US' : 'es-CO';
  function invoiceInput(invoice: SubscriptionInvoiceDto) {
    const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
    const fmtDateTime = (iso: string) => `${fmt(iso)} · ${new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))}`;
    return {
      businessName: business.name,
      businessTaxId: business.taxId,
      businessEmail: user.email ?? '',
      businessPhone: business.whatsapp || null,
      paymentId: invoice.id,
      dateLabel: fmtDateTime(invoice.createdAt),
      planLabel: invoice.plan === 'yearly' ? t('plan_yearly') : t('plan_monthly'),
      amount: invoice.amount,
      currency: business.currency,
      paymentMethodLabel: t(`pay_method_${invoice.paymentMethod}`),
      periodStartLabel: fmt(invoice.periodStart),
      periodEndLabel: fmt(invoice.periodEnd),
    };
  }

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
    <SubscriptionView
      t={t}
      language={language}
      currency={business.currency}
      subscription={subscription}
      initialPlan={initialPlan}
      onCheckout={checkout}
      onSkipTrial={skipTrial}
      onClose={close}
      invoices={showInvoices ? invoices : undefined}
      onDownloadInvoice={(invoice) => downloadSubscriptionInvoicePdf(invoiceInput(invoice))}
      onViewPosTicket={(invoice) => downloadSubscriptionPosTicketPdf(invoiceInput(invoice))}
    />
  );
}
