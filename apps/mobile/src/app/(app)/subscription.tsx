/**
 * Paywall nativo (iOS/Android) vía RevenueCat — StoreKit 2 y Play Billing detrás de un único SDK y un único webhook
 * en el backend. Versión web (Stripe): subscription.web.tsx, sin código ni dependencias nativas compartidas.
 */
import { formatMoney, SUBSCRIPTION_PLANS, SUBSCRIPTION_PRICING, TRIAL_DAYS, YEARLY_SAVINGS_PCT, type SubscriptionPlan } from '@xiro/shared';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import type { PurchasesError, PurchasesOffering } from 'react-native-purchases';
import { configurePurchases, currentOffering, packageForPlan, purchasesAvailable, purchasePlan, restore } from '@/lib/purchases.native';
import { useInvalidateSubscription, useSubscription } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius, space } from '@/ui/theme';

const STORE_NAME = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

export default function SubscriptionScreen() {
  const { t, colors } = useSettings();
  const { business } = useSession();
  const router = useRouter();
  const { toast } = useDialogs();
  const { data: subscription } = useSubscription();
  const invalidateSubscription = useInvalidateSubscription();
  const { plan: requestedPlan } = useLocalSearchParams<{ plan?: string }>();

  /** "Renovar ahora" (desde el aviso de vencimiento) llega con ?plan= para preseleccionar el plan actual. */
  const initialPlan = (SUBSCRIPTION_PLANS as readonly string[]).includes(requestedPlan ?? '') ? (requestedPlan as SubscriptionPlan) : 'yearly';
  const [plan, setPlan] = useState<SubscriptionPlan>(initialPlan);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [offeringError, setOfferingError] = useState(false);
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);

  const trialEligible = subscription?.status === 'none';
  const alreadyPremium = subscription ? subscription.hasAccess && subscription.status !== 'none' : false;

  useEffect(() => {
    if (!business || !purchasesAvailable()) {
      setOfferingError(!purchasesAvailable());
      return;
    }
    let active = true;
    (async () => {
      await configurePurchases(business.id);
      try {
        const found = await currentOffering();
        if (active) setOffering(found);
      } catch {
        if (active) setOfferingError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [business]);

  const priceFor = (target: SubscriptionPlan): string => {
    const pkg = offering ? packageForPlan(offering, target) : null;
    if (pkg) return pkg.product.priceString;
    // Sin ofertas cargadas todavía (o RevenueCat no configurado en este entorno): precio indicativo, no el final del cobro.
    return formatMoney(SUBSCRIPTION_PRICING[target].amount, business?.currency ?? 'COP');
  };

  async function subscribe() {
    if (!business) return;
    if (!offering) return setOfferingError(true);
    const pkg = packageForPlan(offering, plan);
    if (!pkg) return setOfferingError(true);
    setBusy('purchase');
    try {
      await purchasePlan(pkg);
      await invalidateSubscription();
      toast(t('saved'));
      router.back();
    } catch (error) {
      if ((error as PurchasesError)?.userCancelled) return; // el usuario cerró la hoja de compra: no es un error
      toast(t('subscription_purchase_error'));
    } finally {
      setBusy(null);
    }
  }

  async function restorePurchases() {
    setBusy('restore');
    try {
      await restore();
      await invalidateSubscription();
      toast(t('restore_purchases_done'));
    } catch {
      toast(t('restore_purchases_none'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen header={<Header title={t('subscription_title')} subtitle={t('subscription_subtitle')} />}>
      {alreadyPremium ? (
        <View style={[styles.currentPlan, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
          <Ionicons name="checkmark-circle" size={22} color={colors.gold} />
          <View style={styles.flex}>
            <AppText variant="label" tone="gold">
              {t('subscription_current_plan')}
            </AppText>
            <AppText variant="bodyStrong">{subscription?.plan === 'yearly' ? t('plan_yearly') : t('plan_monthly')}</AppText>
          </View>
        </View>
      ) : null}

      <View style={styles.plans}>
        {(['monthly', 'yearly'] as const).map((option) => {
          const selected = plan === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setPlan(option)}
              style={[styles.plan, { borderColor: selected ? colors.gold : colors.border, backgroundColor: selected ? colors.goldTint : colors.surface }]}>
              <View style={styles.planTop}>
                <AppText variant="bodyStrong">{option === 'monthly' ? t('plan_monthly') : t('plan_yearly')}</AppText>
                {option === 'yearly' ? (
                  <View style={[styles.badge, { backgroundColor: colors.gold }]}>
                    <AppText variant="label" tone="onGold">
                      {t('plan_yearly_savings', { pct: YEARLY_SAVINGS_PCT })}
                    </AppText>
                  </View>
                ) : null}
              </View>
              <AppText variant="title">
                {priceFor(option)}
                <AppText variant="body" tone="muted">
                  {option === 'monthly' ? t('plan_period_month') : t('plan_period_year')}
                </AppText>
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.benefits}>
        {(['plan_benefit_full_access', 'plan_benefit_updates', 'plan_benefit_support'] as const).map((key) => (
          <View key={key} style={styles.benefitRow}>
            <Ionicons name="checkmark" size={18} color={colors.gold} />
            <AppText style={styles.flex}>{t(key)}</AppText>
          </View>
        ))}
      </View>

      {trialEligible ? (
        <AppText center tone="gold" variant="bodyStrong" style={styles.trialLine}>
          {t('trial_days_free', { days: TRIAL_DAYS })} · {t('trial_then_price', { price: priceFor(plan) })}
        </AppText>
      ) : (
        <AppText center tone="muted" style={styles.trialLine}>
          {t('trial_not_eligible_notice')}
        </AppText>
      )}

      {offeringError ? (
        <AppText center tone="danger" style={styles.trialLine}>
          {t('subscription_offering_error')}
        </AppText>
      ) : null}

      <Button label={trialEligible ? t('subscribe_trial_cta') : t('subscribe_cta')} onPress={subscribe} loading={busy === 'purchase'} disabled={!offering || busy !== null} />
      <Pressable accessibilityRole="button" onPress={restorePurchases} disabled={busy !== null} style={styles.restore}>
        <AppText tone="gold" variant="bodyStrong">
          {busy === 'restore' ? t('loading') : t('restore_purchases')}
        </AppText>
      </Pressable>

      <AppText tone="muted" variant="small" style={styles.legal}>
        {t('subscription_auto_renew_notice', { store: STORE_NAME })}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  currentPlan: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg },
  plans: { flexDirection: 'row', gap: space.md, marginBottom: space.lg },
  plan: { flex: 1, borderWidth: 1.5, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  benefits: { gap: space.sm, marginBottom: space.lg },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  trialLine: { marginBottom: space.lg },
  restore: { alignSelf: 'center', minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, marginTop: space.sm },
  legal: { marginTop: space.xl, textAlign: 'center' },
});
