import { translate, type Language, type PublicServiceDto, type PublicTeamMemberDto } from '@xiro/shared';
import { useState } from 'react';
import { initials } from '../lib/format';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

/**
 * Profesionales visibles: foto, nombre y su presentación breve (la "especialidad" que el negocio escribió). Al tocar
 * la tarjeta se abre un modal con su información completa: bio y los servicios que realiza (cruzando `serviceIds`
 * contra el catálogo ya cargado por la página). Sin datos de más, no se inventan secciones vacías. Nunca contacto personal.
 */
export function TeamSection({ team, services, language }: { team: PublicTeamMemberDto[]; services: PublicServiceDto[]; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [openId, setOpenId] = useState<string | null>(null);
  if (team.length === 0) return null;
  const open = team.find((member) => member.id === openId) ?? null;
  const openServiceNames = open ? services.filter((s) => open.serviceIds.includes(s.id)).map((s) => s.name) : [];

  return (
    <section className="xp-section" id="equipo" aria-labelledby="xp-team-h">
      <p className="xp-kicker" aria-hidden="true">
        {t('pub_kicker_team')}
      </p>
      <h2 id="xp-team-h">{t('pub_nav_team')}</h2>
      <ul className="xp-team-grid">
        {team.map((member) => (
          <li key={member.id}>
            <button type="button" className="xp-member" aria-label={t('pub_team_open', { name: member.name })} onClick={() => setOpenId(member.id)}>
              {member.photoUrl ? (
                <img className="xp-member-photo" src={member.photoUrl} alt="" width={96} height={96} loading="lazy" decoding="async" />
              ) : (
                <span className="xp-member-photo xp-member-photo--fallback" aria-hidden="true">
                  {initials(member.name)}
                </span>
              )}
              <p className="xp-member-name">{member.name}</p>
              {member.bio ? <p className="xp-member-bio">{member.bio}</p> : null}
              <span className="xp-member-cta">
                {t('pub_team_view_profile')}
                <Icon name="next" size={14} />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open ? (
        <Modal title={open.name} onClose={() => setOpenId(null)} footer={<Button variant="secondary" full={false} onClick={() => setOpenId(null)}>{t('close')}</Button>}>
          <div className="xp-member-detail">
            {open.photoUrl ? (
              <img className="xp-member-detail-photo" src={open.photoUrl} alt="" width={96} height={96} />
            ) : (
              <span className="xp-member-detail-photo xp-member-photo--fallback" aria-hidden="true">
                {initials(open.name)}
              </span>
            )}
            {open.bio ? <p className="xp-member-detail-bio">{open.bio}</p> : null}
            {openServiceNames.length > 0 ? (
              <div className="xp-member-detail-services">
                <h3>{t('pub_team_services')}</h3>
                <ul>
                  {openServiceNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
