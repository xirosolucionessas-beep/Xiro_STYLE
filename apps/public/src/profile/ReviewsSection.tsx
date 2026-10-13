import { formatDay, localDate, translate, upperFirst, type ClientAccountDto, type ClientAppointmentDto, type Language, type PublicBookingProfile, type PublicReviewDto } from '@xiro/shared';
import { useState } from 'react';
import { publicApi } from '../api';
import { errorKey, useAsync } from '../lib/useAsync';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { StarRating } from '../ui/StarRating';
import { Stars } from '../ui/Stars';
import { formatRating } from './Hero';

/**
 * Reseñas: resumen (promedio real, estrellas y número de opiniones aprobadas por el negocio), las reseñas publicadas y cómo
 * dejar la propia. Solo reseña quien tuvo una cita COMPLETADA (desde el enlace de su cita, el que llega al completarla o, con
 * sesión, aquí mismo); cada reseña queda "por revisar" hasta que el negocio la aprueba y solo entonces cuenta en el promedio.
 * Los comentarios se muestran como texto (React escapa todo: nunca se interpreta HTML).
 */
export function ReviewsSection({ reviews, language, profile, slug, account }: { reviews: PublicReviewDto[]; language: Language; profile: PublicBookingProfile; slug: string; account?: ClientAccountDto | null }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const { average, count } = profile.rating;
  const hasRating = count > 0 && average !== null;

  return (
    <section className="xp-section" id="resenas" aria-labelledby="xp-reviews-h">
      <p className="xp-kicker" aria-hidden="true">
        {t('pub_kicker_reviews')}
      </p>
      <h2 id="xp-reviews-h">{t('pub_nav_reviews')}</h2>

      <div className="xp-review-summary">
        {hasRating ? (
          <>
            <strong className="xp-review-avg">{formatRating(average, language)}</strong>
            <div className="xp-review-summary-text">
              <Stars value={average} size={20} label={t('pub_stars_label', { rating: formatRating(average, language) })} />
              <span className="xp-muted">{count === 1 ? t('pub_reviews_one') : t('pub_reviews_count', { count })}</span>
            </div>
          </>
        ) : (
          <div className="xp-review-summary-text">
            <Stars value={null} size={20} label={t('pub_reviews_none')} />
            <span>{t('pub_reviews_first')}</span>
          </div>
        )}
      </div>

      {reviews.length > 0 ? (
        <ul className="xp-review-list">
          {reviews.map((review, i) => (
            <li key={i} className="xp-review">
              <Stars value={review.rating} label={`${review.rating} / 5`} />
              {review.comment ? <p>{review.comment}</p> : null}
              <p className="xp-muted">{review.authorName}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {account ? <AccountReviews slug={slug} language={language} /> : <p className="xp-hint xp-review-how">{t('pub_reviews_how')}</p>}
    </section>
  );
}

/** Con sesión: las citas COMPLETADAS de esta persona que aún no tienen reseña, cada una con su formulario. */
function AccountReviews({ slug, language }: { slug: string; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const state = useAsync(() => publicApi.accountAppointments(slug).catch(() => [] as ClientAppointmentDto[]), [slug]);
  const [sent, setSent] = useState<string[]>([]);
  const pending = (state.data ?? []).filter((a) => a.canReview && !sent.includes(a.id));
  if (state.loading) return null;
  if (pending.length === 0 && sent.length === 0) return <p className="xp-hint xp-review-how">{t('pub_reviews_how')}</p>;
  return (
    <div className="xp-stack xp-review-mine">
      {sent.length > 0 ? <Alert tone="success">{t('pub_review_sent_text')}</Alert> : null}
      {pending.map((appointment) => (
        <AccountReviewForm key={appointment.id} slug={slug} appointment={appointment} language={language} onSent={() => setSent((s) => [...s, appointment.id])} />
      ))}
    </div>
  );
}

function AccountReviewForm({ slug, appointment, language, onSent }: { slug: string; appointment: ClientAppointmentDto; language: Language; onSent: () => void }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const day = upperFirst(formatDay(localDate(appointment.startsAt, appointment.business.timezone), language, { weekday: 'long', day: 'numeric', month: 'long' }));

  async function submit() {
    if (rating < 1) return setError(t('pub_review_err_rating'));
    setBusy(true);
    setError(undefined);
    try {
      await publicApi.accountReview(slug, appointment.id, rating, comment.trim());
      onSent();
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="xp-card xp-stack">
      <p>
        <strong>{t('pub_reviews_rate_visit')}</strong>
        <br />
        <span className="xp-muted">
          {appointment.items.map((i) => i.name).join(' · ')} · {day}
        </span>
      </p>
      <StarRating value={rating} onChange={setRating} label={t('pub_review_rating')} starLabel={(n) => t('reviews_stars', { count: n })} />
      <label className="xp-field">
        <span className="xp-label">{t('pub_review_comment')}</span>
        <textarea className="xp-textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
        <span className="xp-hint">{t('pub_chars_left', { n: 500 - comment.length })}</span>
      </label>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button full={false} loading={busy} onClick={() => void submit()}>
        {t('pub_review_submit')}
      </Button>
    </div>
  );
}
