import { Ionicons } from '@expo/vector-icons';
import { accountAccessSummary, accountAccessTextKeys, type AccountAccessKind } from '@xiro/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { useSubscription } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { Card } from './Kit';
import { AppText } from './Text';

const ICON: Record<AccountAccessKind, keyof typeof Ionicons.glyphMap> = {
  trial: 'sparkles-outline',
  active: 'checkmark-circle',
  grace: 'alert-circle',
  courtesy: 'gift-outline',
  expired: 'close-circle',
  canceled: 'close-circle',
  no_plan: 'remove-circle-outline',
  no_access: 'close-circle',
};

/**
 * Tarjeta "Suscripción y estado de cuenta" del perfil (Android/iOS). Datos: GET /api/subscription (hook existente). Toda la
 * regla de qué estado y qué fecha mostrar vive en @xiro/shared (accountAccessSummary), igual que en la web. Un error aquí no
 * bloquea el resto del perfil.
 */
export function SubscriptionStatusCard() {
  const { t, language, colors } = useSettings();
  const { user, business } = useSession();
  const router = useRouter();
  const query = useSubscription();
  const { refetch } = query;
  // Al volver al perfil (p. ej. desde una notificación de acceso ampliado) se consulta de nuevo: refleja el cambio real.
  useFocusEffect(useCallback(() => void refetch(), [refetch]));

  const timezone = business?.timezone ?? 'America/Bogota';
  const formatDate = (iso: string) => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-CO', { dateStyle: 'long', timeZone: timezone }).format(new Date(iso));

  if (query.isLoading) {
    return (
      <Card style={{ marginBottom: 18 }}>
        <AppText variant="label" tone="gold">
          {t('account_access_title')}
        </AppText>
        <AppText tone="muted" style={{ marginTop: 6 }}>
          {t('account_access_loading')}
        </AppText>
      </Card>
    );
  }
  if (query.error || !query.data) {
    return (
      <Card style={{ marginBottom: 18, gap: 8 }}>
        <AppText variant="label" tone="gold">
          {t('account_access_title')}
        </AppText>
        <AppText tone="danger" accessibilityRole="alert">
          {t('account_access_error')}
        </AppText>
        <Button label={t('account_access_retry')} icon="refresh" variant="secondary" compact loading={query.isFetching} onPress={() => void refetch()} style={{ alignSelf: 'flex-start' }} />
      </Card>
    );
  }

  const summary = accountAccessSummary(query.data);
  const keys = accountAccessTextKeys(summary);
  const isOwner = user?.role !== 'employee';
  const tone = summary.kind === 'grace' ? colors.warning : summary.hasAccess ? colors.success : colors.danger;

  return (
    <Card style={{ marginBottom: 18, gap: 8 }}>
      <AppText variant="label" tone="gold" accessibilityRole="header">
        {t('account_access_title')}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessible accessibilityLabel={t(keys.title)}>
        <Ionicons name={ICON[summary.kind]} size={20} color={tone} />
        <AppText variant="heading" style={{ flex: 1 }}>
          {t(keys.title)}
        </AppText>
      </View>
      <AppText tone="muted">{t(keys.description)}</AppText>
      {keys.dateLabel ? (
        <View style={{ gap: 2 }}>
          <AppText variant="small" tone="muted">
            {t(keys.dateLabel)}
          </AppText>
          <AppText variant="bodyStrong">{summary.endsAt ? formatDate(summary.endsAt) : t('account_access_date_unknown')}</AppText>
          {keys.days ? (
            <AppText variant="small" style={{ color: tone }}>
              {t(keys.days.key, keys.days.n !== undefined ? { n: keys.days.n } : undefined)}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {summary.courtesyEndsAt && summary.kind !== 'courtesy' ? <AppText variant="small">{t('account_access_courtesy_also', { date: formatDate(summary.courtesyEndsAt) })}</AppText> : null}
      {summary.upcomingCourtesy ? (
        <AppText variant="small">{t('account_access_upcoming', { from: formatDate(summary.upcomingCourtesy.startsAt), to: formatDate(summary.upcomingCourtesy.endsAt) })}</AppText>
      ) : null}
      {!isOwner ? (
        <AppText variant="small" tone="muted">
          {t('account_access_employee_note')}
        </AppText>
      ) : (
        <Button label={t('account_access_manage')} icon="card-outline" variant="secondary" compact onPress={() => router.push('/subscription')} style={{ alignSelf: 'flex-start' }} />
      )}
    </Card>
  );
}
