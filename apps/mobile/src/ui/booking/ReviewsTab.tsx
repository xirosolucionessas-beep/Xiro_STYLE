import { useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { keys, useBookingReviews } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { Card, EmptyState } from '../Kit';
import { AppText } from '../Text';
import { useAction } from './useAction';

/** Moderación de reseñas: solo las aprobadas aparecen en la página pública y cuentan en la calificación. */
export function ReviewsTab() {
  const { t, language } = useSettings();
  const queryClient = useQueryClient();
  const reviews = useBookingReviews();
  const action = useAction();

  async function moderate(id: string, status: 'approved' | 'hidden') {
    const saved = await action.run(() => api.moderateReview(id, status));
    if (saved) await queryClient.invalidateQueries({ queryKey: keys.bookingReviews });
  }

  if (reviews.isLoading) return <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('loading')} />;
  if (reviews.isError) {
    return (
      <View style={{ gap: 8 }}>
        <AppText tone="danger">{t(errorKey(reviews.error))}</AppText>
        <Button label={t('retry')} variant="secondary" compact onPress={() => void reviews.refetch()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <AppText tone="muted">{t('reviews_hint')}</AppText>
      {action.error ? (
        <AppText tone="danger" accessibilityLiveRegion="polite">
          {action.error}
        </AppText>
      ) : null}
      {(reviews.data ?? []).length === 0 ? <EmptyState icon="star-outline" message={t('reviews_empty')} /> : null}
      {(reviews.data ?? []).map((review) => (
        <Card key={review.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppText variant="heading" tone="gold" accessibilityLabel={t('reviews_stars', { count: review.rating })}>
              {'★'.repeat(review.rating)}
              {'☆'.repeat(5 - review.rating)}
            </AppText>
            <AppText variant="small" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
              {t(`reviews_status_${review.status}`)}
            </AppText>
          </View>
          <AppText variant="bodyStrong">{review.authorName}</AppText>
          {review.comment ? <AppText>{review.comment}</AppText> : null}
          <AppText variant="small" tone="muted">
            {new Date(review.createdAt).toLocaleDateString(language === 'en' ? 'en-US' : 'es-CO')}
          </AppText>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {review.status !== 'approved' ? <Button label={t('reviews_approve')} compact disabled={action.busy} onPress={() => void moderate(review.id, 'approved')} /> : null}
            {review.status !== 'hidden' ? <Button label={t('reviews_hide')} variant="secondary" compact disabled={action.busy} onPress={() => void moderate(review.id, 'hidden')} /> : null}
          </View>
        </Card>
      ))}
    </View>
  );
}
