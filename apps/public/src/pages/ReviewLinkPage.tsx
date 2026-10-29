import { formatDay, localDate, translate, upperFirst, type Language, type PublicAppointmentDto } from '@xiro/shared';
import { useState } from 'react';
import { publicApi } from '../api';
import { useBrand } from '../lib/brand';
import { navigate, profilePath } from '../lib/route';
import { errorKey, useAsync } from '../lib/useAsync';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StarRating } from '../ui/StarRating';

/** Reseñar una cita completada con el enlace que el negocio envió (Fase 4). Ese enlace solo sirve para esto. */
export function ReviewLinkPage({ slug, token, language }: { slug: string; token: string; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const brandState = useAsync(() => publicApi.profile(slug).catch(() => null), [slug]);
  useBrand(brandState.data?.accentColor);
  const state = useAsync(() => publicApi.reviewLink(slug, token), [slug, token]);
  const [appointment, setAppointment] = useState<PublicAppointmentDto>();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const current = appointment ?? state.data;

  if (state.loading) {
    return (
      <div className="xp-empty" role="status">
        <span className="xp-spinner" aria-hidden="true" />
        <p>{t('loading')}</p>
      </div>
    );
  }
  if (state.error || !current) {
    return (
      <div className="xp-empty" role="alert">
        <h1>{t('pub_manage_not_found_title')}</h1>
        <p>{t('pub_manage_not_found_text')}</p>
      </div>
    );
  }

  async function submit() {
    if (rating < 1) return setError(t('pub_review_err_rating'));
    setBusy(true);
    setError(undefined);
    try {
      setAppointment(await publicApi.submitReviewLink(slug, token, rating, comment.trim()));
      setSent(true);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  const day = upperFirst(formatDay(localDate(current.startsAt, current.business.timezone), language, { weekday: 'long', day: 'numeric', month: 'long' }));
  const services = current.items.map((i) => i.name).join(' · ');
  return (
    <div className="xp-page">
      <main className="xp-main xp-container">
        <div className="xp-section xp-stack">
          <button type="button" className="xp-back-to-business" onClick={() => navigate(profilePath(slug))}>
            <Icon name="back" size={16} /> {t('pub_my_account_back_to_business')}
          </button>
          <h1>{t('pub_review_link_title', { business: current.business.name })}</h1>
          <div className="xp-card xp-stack">
            <p>
              <strong>{services}</strong>
            </p>
            <p className="xp-muted">
              {day} · {t('pub_manage_with', { name: current.professionalName })}
            </p>
          </div>
          <section className="xp-card xp-stack" aria-labelledby="xp-review-link-h">
            {sent || !current.canReview ? (
              <>
                <h2 id="xp-review-link-h">{t('pub_review_sent_title')}</h2>
                <p className="xp-muted">{t(sent ? 'pub_review_sent_text' : 'pub_review_link_already')}</p>
              </>
            ) : (
              <>
                <h2 id="xp-review-link-h">{t('pub_review_title')}</h2>
                <p className="xp-hint">{t('pub_review_hint')}</p>
                <StarRating value={rating} onChange={setRating} label={t('pub_review_rating')} starLabel={(n) => t('reviews_stars', { count: n })} />
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <label className="xp-field" htmlFor="xp-review-link-comment">
                  <span className="xp-label">{t('pub_review_comment')}</span>
                  <textarea id="xp-review-link-comment" className="xp-textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
                </label>
                <Button full={false} loading={busy} onClick={() => void submit()}>
                  {t('pub_review_submit')}
                </Button>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
