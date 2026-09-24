/**
 * Aviso de vencimiento/vencida de la suscripción (sección 4). Bloqueante (sin botón de cerrar) SOLO cuando de
 * verdad no hay acceso (`blocked`); en período de gracia o "por vencer pronto" se puede descartar — no bloquea
 * el acceso que todavía tiene. La misma regla (`subscriptionNotice`) la usa también la versión web.
 */
import { subscriptionNotice, type Subscription } from '@xiro/shared';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSubscription } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { useDialogs } from './Dialogs';
import { AppText } from './Text';
import { radius, space } from './theme';

function noticeKey(subscription: Subscription): string | null {
  const notice = subscriptionNotice(subscription);
  if (!notice) return null;
  // Identifica el aviso concreto (no solo el tipo): si cambia la fecha de vencimiento (p. ej. tras renovar y volver
  // a vencer más adelante), un aviso ya descartado antes vuelve a mostrarse.
  return `${notice}:${subscription.trialEndsAt}:${subscription.currentPeriodEnd}:${subscription.gracePeriodEndsAt}`;
}

export function SubscriptionGate() {
  const { t, colors, language } = useSettings();
  const router = useRouter();
  const { status: sessionStatus, signOut, user } = useSession();
  const isEmployee = user?.role === 'employee';
  const { data: subscription } = useSubscription(sessionStatus === 'signedIn');
  const { confirm } = useDialogs();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (sessionStatus !== 'signedIn' || !subscription) return null;
  const notice = subscriptionNotice(subscription);
  const key = noticeKey(subscription);
  if (!notice || !key || dismissed === key) return null;
  // Un empleado no puede renovar ni ver planes: solo se le avisa cuando ya no hay acceso, y se le dice a quién acudir.
  if (isEmployee && notice !== 'blocked') return null;

  const blocking = notice === 'blocked';
  const dueDateRaw = notice === 'grace' ? subscription.gracePeriodEndsAt : subscription.status === 'trial' ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  const dateLabel = dueDateRaw ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'long' }).format(new Date(dueDateRaw)) : '';
  const titleKey = blocking ? 'subscription_expired_title' : notice === 'grace' ? 'subscription_grace_title' : 'subscription_expiring_title';
  const bodyKey = isEmployee ? 'subscription_employee_blocked_body' : blocking ? 'subscription_expired_body' : notice === 'grace' ? 'subscription_grace_body' : 'subscription_expiring_body';

  const dismiss = () => setDismissed(key);
  const goToPlans = (preselectCurrent: boolean) => {
    dismiss();
    router.push(preselectCurrent && subscription.plan ? { pathname: '/subscription', params: { plan: subscription.plan } } : '/subscription');
  };
  const logout = async () => {
    if (await confirm({ title: t('logout'), message: t('logout_sub'), confirmLabel: t('logout'), destructive: true })) await signOut();
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={blocking ? undefined : dismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { borderColor: colors.gold }]}>
          {!blocking ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={dismiss} style={styles.close} hitSlop={10}>
              <Ionicons name="close" size={20} color="#9c9689" />
            </Pressable>
          ) : null}
          <View style={[styles.icon, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
            <Ionicons name="calendar-outline" size={30} color={colors.gold} />
            <View style={[styles.clockBadge, { backgroundColor: colors.gold }]}>
              <Ionicons name="time" size={14} color={colors.onGold} />
            </View>
          </View>
          <AppText variant="title" center style={styles.title}>
            {t(titleKey)}
          </AppText>
          <AppText center style={styles.body}>
            {t(bodyKey, { date: dateLabel })}
          </AppText>
          {isEmployee ? null : (
            <>
              <Button label={t('renew_now')} onPress={() => goToPlans(true)} style={styles.action} />
              <Button label={t('view_plans')} variant="secondary" onPress={() => goToPlans(false)} style={styles.action} />
            </>
          )}
          {blocking ? (
            <Pressable accessibilityRole="button" onPress={logout} style={styles.logout}>
              <AppText style={{ color: '#9c9689' }} variant="bodyStrong">
                {t('logout')}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: 'rgba(0,0,0,0.75)' },
  card: { width: '100%', maxWidth: 380, borderWidth: 1, borderRadius: radius.xl, padding: space.xl, alignItems: 'center', backgroundColor: '#141210' },
  close: { position: 'absolute', top: space.md, right: space.md, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  clockBadge: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#141210' },
  title: { color: '#ffffff', marginTop: space.lg },
  body: { color: '#c9c3b6', marginTop: space.sm, marginBottom: space.lg },
  action: { width: '100%', marginTop: space.sm },
  logout: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: space.md },
});
