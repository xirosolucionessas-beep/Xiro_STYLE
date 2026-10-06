import { translate, type Language, type PublicReviewDto } from '@xiro/shared';
import { Icon } from '../ui/Icon';

/** Reseñas ya aprobadas por el negocio: estrellas con su número en el texto (no solo color), comentario y autor abreviado. */
export function ReviewsSection({ reviews, language }: { reviews: PublicReviewDto[]; language: Language }) {
  const t = (key: string) => translate(language, key);
  if (reviews.length === 0) return null;
  return (
    <section className="xp-section" id="resenas" aria-labelledby="xp-reviews-h">
      <p className="xp-kicker" aria-hidden="true">
        {t('pub_kicker_reviews')}
      </p>
      <h2 id="xp-reviews-h">{t('pub_nav_reviews')}</h2>
      <ul className="xp-review-list">
        {reviews.map((review, i) => (
          <li key={i} className="xp-review">
            <span className="xp-stars" role="img" aria-label={`${review.rating} / 5`}>
              {Array.from({ length: 5 }, (_, n) => (
                <span key={n} className={n < review.rating ? 'is-on' : 'is-off'}>
                  <Icon name="star" size={16} />
                </span>
              ))}
            </span>
            {review.comment ? <p>{review.comment}</p> : null}
            <p className="xp-muted">{review.authorName}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
