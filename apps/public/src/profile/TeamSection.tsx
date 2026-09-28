import { translate, type Language, type PublicTeamMemberDto } from '@xiro/shared';
import { initials } from '../lib/format';

/** Profesionales visibles: foto, nombre y su presentación breve (la "especialidad" que el negocio escribió). Nunca contacto personal. */
export function TeamSection({ team, language }: { team: PublicTeamMemberDto[]; language: Language }) {
  const t = (key: string) => translate(language, key);
  if (team.length === 0) return null;
  return (
    <section className="xp-section" id="equipo" aria-labelledby="xp-team-h">
      <h2 id="xp-team-h">{t('pub_nav_team')}</h2>
      <ul className="xp-team-grid">
        {team.map((member) => (
          <li key={member.id} className="xp-member">
            {member.photoUrl ? (
              <img className="xp-member-photo" src={member.photoUrl} alt="" width={96} height={96} loading="lazy" decoding="async" />
            ) : (
              <span className="xp-member-photo xp-member-photo--fallback" aria-hidden="true">
                {initials(member.name)}
              </span>
            )}
            <p className="xp-member-name">{member.name}</p>
            {member.bio ? <p className="xp-member-bio">{member.bio}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
