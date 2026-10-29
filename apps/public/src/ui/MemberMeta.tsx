import type { PublicTeamMemberDto } from '@xiro/shared';
import { Icon } from './Icon';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Especialidad y calificación de un profesional (Fase 3): "Colorista · ★ 4,8 (12)". La calificación sale de las reseñas
 * aprobadas de SUS citas (servidor); sin reseñas no se muestra nada (nunca un "0 estrellas" que asuste).
 */
export function MemberMeta({ member, t, language }: { member: Pick<PublicTeamMemberDto, 'specialty' | 'rating'>; t: T; language: string }) {
  const rating = member.rating && member.rating.count > 0 && member.rating.average !== null ? member.rating : null;
  if (!member.specialty && !rating) return null;
  const average = rating ? rating.average!.toLocaleString(language === 'en' ? 'en-US' : 'es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '';
  return (
    <span className="xp-member-meta">
      {member.specialty ? <span className="xp-member-specialty">{member.specialty}</span> : null}
      {rating ? (
        <span className="xp-member-rating" aria-label={t('pub_member_rating_aria', { rating: average, count: rating.count })}>
          <Icon name="star" size={13} />
          <span aria-hidden="true">
            {average} ({rating.count})
          </span>
        </span>
      ) : null}
    </span>
  );
}
