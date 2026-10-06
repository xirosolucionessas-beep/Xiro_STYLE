import { formatClock, formatDay, localDate, localTime, translate, upperFirst, type ClientAccountDto, type Language, type PublicAppointmentDto } from '@xiro/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, publicApi, type LoyaltyAccountView } from '../api';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { profilePath, navigate, accountPath } from '../lib/route';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

type Tab = 'appointments' | 'loyalty' | 'profile';

/** "Mi cuenta": mis citas, fidelización (si el negocio la tiene activa) y mi perfil — todo bajo la misma ruta. */
export function MyAccountPage({ slug, language, account, onAccountChange, onLogout }: { slug: string; language: Language; account: ClientAccountDto | null | undefined; onAccountChange: (account: ClientAccountDto) => void; onLogout: () => void }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [tab, setTab] = useState<Tab>('appointments');

  useEffect(() => {
    if (account === null) navigate(accountPath(slug, 'ingresar'));
  }, [account, slug]);

  const loyalty = useAsync(() => (account ? publicApi.accountLoyalty(slug) : Promise.resolve({ active: false as const })), [slug, Boolean(account)]);
  // Con el programa apagado, la pestaña desaparece del todo (no solo su contenido): si quedó elegida de antes
  // (otro negocio sí lo tenía activo), se corrige al vuelo durante el render, sin un efecto aparte.
  const loyaltyActive = !loyalty.loading && Boolean(loyalty.data?.active);
  const effectiveTab: Tab = tab === 'loyalty' && !loyaltyActive ? 'appointments' : tab;

  if (!account) return null; // undefined: aún resolviendo; null: ya se redirige arriba

  if (account.mustChangePassword) {
    return (
      <div className="xp-auth">
        <div className="xp-auth-card">
          <h1 className="xp-auth-name">{t('pub_my_account_must_change_password_title')}</h1>
          <p className="xp-hint">{t('pub_my_account_must_change_password_text')}</p>
          <ForcedPasswordForm slug={slug} t={t} onDone={onAccountChange} />
        </div>
      </div>
    );
  }

  return (
    <div className="xp-container">
      <div className="xp-seg" role="radiogroup" aria-label={t('pub_my_account_title')} style={{ margin: '20px 0' }}>
        <button type="button" role="radio" aria-checked={effectiveTab === 'appointments'} className="xp-seg-btn xp-seg-btn--text" onClick={() => setTab('appointments')}>
          {t('pub_my_account_nav_appointments')}
        </button>
        {loyaltyActive ? (
          <button type="button" role="radio" aria-checked={effectiveTab === 'loyalty'} className="xp-seg-btn xp-seg-btn--text" onClick={() => setTab('loyalty')}>
            {t('pub_my_account_nav_loyalty')}
          </button>
        ) : null}
        <button type="button" role="radio" aria-checked={effectiveTab === 'profile'} className="xp-seg-btn xp-seg-btn--text" onClick={() => setTab('profile')}>
          {t('pub_my_account_nav_profile')}
        </button>
      </div>

      {effectiveTab === 'appointments' ? <AppointmentsTab slug={slug} language={language} t={t} /> : null}
      {effectiveTab === 'loyalty' ? <LoyaltyTab loyalty={loyalty} t={t} /> : null}
      {effectiveTab === 'profile' ? <ProfileTab slug={slug} account={account} t={t} onAccountChange={onAccountChange} onLogout={onLogout} /> : null}
    </div>
  );
}

function AppointmentsTab({ slug, language, t }: { slug: string; language: Language; t: (k: string, p?: Record<string, string | number>) => string }) {
  const state = useAsync(() => publicApi.accountAppointments(slug), [slug]);
  if (state.loading) return <p className="xp-muted">{t('loading')}</p>;
  const appointments: PublicAppointmentDto[] = state.data ?? [];
  if (appointments.length === 0) return <p className="xp-muted">{t('pub_my_account_appointments_empty')}</p>;
  return (
    <ul className="xp-price-list">
      {appointments.map((appt, i) => (
        <li key={i} className="xp-price-row">
          <div className="xp-price-main">
            <div className="xp-price-top">
              <h3 className="xp-price-name">{upperFirst(formatDay(localDate(appt.startsAt, appt.business.timezone), language, { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>
              <span className="xp-price">{formatClock(localTime(appt.startsAt, appt.business.timezone), language)}</span>
            </div>
            <div className="xp-price-sub">
              <span className="xp-price-desc">{appt.items.map((item) => item.name).join(' + ')}</span>
            </div>
            <div className="xp-price-sub">
              <span className="xp-meta">{appt.professionalName}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function LoyaltyTab({ loyalty: state, t }: { loyalty: AsyncState<LoyaltyAccountView | { active: false }>; t: (k: string, p?: Record<string, string | number>) => string }) {
  if (state.loading) return <p className="xp-muted">{t('loading')}</p>;
  const loyalty = state.data ?? null;
  if (!loyalty?.active) return <p className="xp-muted">{t('pub_my_account_loyalty_inactive')}</p>;
  const pct = Math.min(100, Math.round(((loyalty.count ?? 0) / (loyalty.goal || 1)) * 100));
  return (
    <div className="xp-stack">
      <p>{t('pub_my_account_loyalty_progress', { count: loyalty.count ?? 0, goal: loyalty.goal ?? 0 })}</p>
      <div className="xp-loyalty-bar">
        <div className="xp-loyalty-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {loyalty.rewardAvailable ? <p className="xp-hint">{t('pub_my_account_loyalty_reward', { message: loyalty.rewardMessage ?? '' })}</p> : null}
    </div>
  );
}

function ForcedPasswordForm({ slug, t, onDone }: { slug: string; t: (k: string) => string; onDone: (account: ClientAccountDto) => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await publicApi.accountChangePassword(slug, { currentPassword, newPassword });
      const me = await publicApi.accountMe(slug);
      if (me) onDone(me);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : t('unknown_error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="xp-stack" onSubmit={(e) => void submit(e)}>
      {error ? (
        <p className="xp-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="xp-field">
        <label className="xp-label" htmlFor="xp-forced-current">
          {t('pub_my_account_current_password_label')}
        </label>
        <input id="xp-forced-current" className="xp-input" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
      </div>
      <div className="xp-field">
        <label className="xp-label" htmlFor="xp-forced-new">
          {t('pub_account_new_password_label')}
        </label>
        <input id="xp-forced-new" className="xp-input" type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </div>
      <Button loading={busy} type="submit">
        {t('pub_my_account_change_password_cta')}
      </Button>
    </form>
  );
}

function ProfileTab({ slug, account, t, onAccountChange, onLogout }: { slug: string; account: ClientAccountDto; t: (k: string, p?: Record<string, string | number>) => string; onAccountChange: (a: ClientAccountDto) => void; onLogout: () => void }) {
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  const [pwError, setPwError] = useState('');

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const updated = await publicApi.accountUpdate(slug, { name, email: email || null });
      onAccountChange(updated);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwError('');
    setPwDone(false);
    try {
      await publicApi.accountChangePassword(slug, { currentPassword, newPassword });
      setPwDone(true);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPwError(err instanceof ApiError ? err.code : t('unknown_error'));
    } finally {
      setPwBusy(false);
    }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await publicApi.accountDelete(slug, deletePassword);
      onLogout();
      navigate(profilePath(slug));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="xp-stack">
      <form className="xp-stack" onSubmit={(e) => void saveProfile(e)}>
        <div className="xp-field">
          <label className="xp-label" htmlFor="xp-prof-name">
            {t('pub_account_name_label')}
          </label>
          <input id="xp-prof-name" className="xp-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="xp-field">
          <label className="xp-label" htmlFor="xp-prof-email">
            {t('pub_account_email_label')}
          </label>
          <input id="xp-prof-email" className="xp-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        </div>
        <Button loading={saving} full={false} type="submit">
          {t('pub_my_account_save')}
        </Button>
        {saved ? <span className="xp-hint">{t('pub_my_account_saved')}</span> : null}
      </form>

      <div className="xp-card xp-stack">
        <h3 className="xp-subtitle">{t('pub_my_account_change_password_cta')}</h3>
        <form className="xp-stack" onSubmit={(e) => void changePassword(e)}>
          {pwError ? (
            <p className="xp-error" role="alert">
              {pwError}
            </p>
          ) : null}
          <input className="xp-input" type="password" placeholder={t('pub_my_account_current_password_label')} autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <input className="xp-input" type="password" placeholder={t('pub_account_new_password_label')} autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <Button loading={pwBusy} full={false} type="submit">
            {t('pub_my_account_change_password_cta')}
          </Button>
          {pwDone ? <span className="xp-hint">{t('pub_my_account_password_changed')}</span> : null}
        </form>
      </div>

      <Button variant="secondary" onClick={onLogout}>
        <Icon name="back" size={16} /> {t('pub_my_account_logout_cta')}
      </Button>

      {!confirmDelete ? (
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          {t('pub_my_account_delete_cta')}
        </Button>
      ) : (
        <div className="xp-card xp-stack">
          <h3 className="xp-subtitle">{t('pub_my_account_delete_confirm_title')}</h3>
          <p className="xp-hint">{t('pub_my_account_delete_confirm_text')}</p>
          <input className="xp-input" type="password" placeholder={t('pub_account_password_label')} value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
          <div className="xp-btn-row">
            <Button variant="ghost" full={false} onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </Button>
            <Button variant="danger" full={false} loading={deleting} onClick={() => void doDelete()}>
              {t('pub_my_account_delete_cta')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
