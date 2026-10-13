import { formatDay, translate, upperFirst, type Language, type PublicWaitlistDto } from '@xiro/shared';
import { useState } from 'react';
import { publicApi } from '../api';
import { useBrand } from '../lib/brand';
import { navigate, profilePath } from '../lib/route';
import { errorKey, useAsync } from '../lib/useAsync';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/** El lugar de alguien en la lista de espera, con su enlace personal: ver en qué va y quitarse si ya no lo necesita. */
export function WaitlistPage({ slug, token, language }: { slug: string; token: string; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const brandState = useAsync(() => publicApi.profile(slug).catch(() => null), [slug]);
  useBrand(brandState.data?.accentColor);
  const state = useAsync(() => publicApi.waitlist(slug, token), [slug, token]);
  const [entry, setEntry] = useState<PublicWaitlistDto>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const current = entry ?? state.data;

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
        <h1>{t('pub_waitlist_not_found_title')}</h1>
        <p>{t('pub_waitlist_not_found_text')}</p>
      </div>
    );
  }

  async function leave() {
    setBusy(true);
    setError(undefined);
    try {
      setEntry(await publicApi.cancelWaitlist(slug, token));
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  const day = upperFirst(formatDay(current.date, language, { weekday: 'long', day: 'numeric', month: 'long' }));
  return (
    <div className="xp-page">
      <main className="xp-main xp-container">
        <div className="xp-section xp-stack">
          <button type="button" className="xp-back-to-business" onClick={() => navigate(profilePath(slug))}>
            <Icon name="back" size={16} /> {t('pub_my_account_back_to_business')}
          </button>
          <h1>{t('pub_waitlist_page_title')}</h1>
          <Alert tone={current.status === 'notified' ? 'success' : 'info'}>{t(`pub_waitlist_status_${current.status}`)}</Alert>
          <div className="xp-card xp-stack">
            <p>
              <strong>{day}</strong>
            </p>
            {current.services.length > 0 ? <p className="xp-muted">{current.services.join(' · ')}</p> : null}
            <p className="xp-muted">{current.business.name}</p>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="xp-btn-row">
            {current.status !== 'cancelled' ? (
              <Button variant="ghost" full={false} loading={busy} onClick={() => void leave()}>
                {t('pub_waitlist_leave')}
              </Button>
            ) : null}
            <Button full={false} onClick={() => navigate(profilePath(slug))}>
              {t(current.status === 'notified' ? 'pub_waitlist_book_now' : 'pub_waitlist_see_page')}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
