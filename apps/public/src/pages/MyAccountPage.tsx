import { formatClock, formatDay, formatMoney, localDate, localTime, translate, upperFirst, type ClientAccountDto, type ClientAppointmentDto, type Currency, type Language } from '@xiro/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { publicApi, type LoyaltyAccountView } from '../api';
import { accountErrorMessage } from '../lib/accountErrors';
import { birthdayAccountText } from '../lib/birthday';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { profilePath, navigate, accountPath } from '../lib/route';
import { Avatar } from '../ui/Avatar';
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
  // Regalo de cumpleaños (si el negocio activó el programa). Se vuelve a pedir al cambiar la fecha en "Mi perfil".
  const birthday = useAsync(() => (account ? publicApi.accountBirthday(slug) : Promise.resolve({ active: false as const })), [slug, Boolean(account), account?.birthDate ?? null]);
  const birthdayText = birthday.data ? birthdayAccountText(t, birthday.data, birthday.data.active ? birthday.data.currency : 'COP') : null;
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
      <button type="button" className="xp-back-to-business" onClick={() => navigate(profilePath(slug))}>
        <Icon name="back" size={16} /> {t('pub_my_account_back_to_business')}
      </button>
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

      {birthdayText ? (
        <section className="xp-card xp-stack" aria-labelledby="xp-birthday-title" style={{ marginBottom: 20 }}>
          <h2 id="xp-birthday-title" className="xp-subtitle">
            {t('pub_birthday_title')}
          </h2>
          <p role="status">{birthdayText}</p>
          {birthday.data?.active && birthday.data.message && birthday.data.reward?.state === 'available' ? <p className="xp-hint">{birthday.data.message}</p> : null}
        </section>
      ) : null}
      {effectiveTab === 'appointments' ? <AppointmentsTab slug={slug} language={language} t={t} /> : null}
      {effectiveTab === 'loyalty' ? <LoyaltyTab loyalty={loyalty} t={t} /> : null}
      {effectiveTab === 'profile' ? <ProfileTab slug={slug} account={account} t={t} onAccountChange={onAccountChange} onLogout={onLogout} /> : null}
    </div>
  );
}

const APPT_STATUS_KEY: Record<ClientAppointmentDto['status'], string> = {
  pending: 'pub_my_account_appt_status_pending',
  confirmed: 'pub_my_account_appt_status_confirmed',
  in_progress: 'pub_my_account_appt_status_in_progress',
  completed: 'pub_my_account_appt_status_completed',
  cancelled: 'pub_my_account_appt_status_cancelled',
  no_show: 'pub_my_account_appt_status_no_show',
};

function AppointmentsTab({ slug, language, t }: { slug: string; language: Language; t: (k: string, p?: Record<string, string | number>) => string }) {
  const state = useAsync(() => publicApi.accountAppointments(slug), [slug]);
  if (state.loading) return <p className="xp-muted">{t('loading')}</p>;
  const appointments: ClientAppointmentDto[] = state.data ?? [];
  if (appointments.length === 0) return <p className="xp-muted">{t('pub_my_account_appointments_empty')}</p>;
  return (
    <div className="xp-stack">
      {appointments.map((appt) => (
        <AppointmentCard key={appt.id} slug={slug} appt={appt} language={language} t={t} onCancelled={() => state.reload()} />
      ))}
    </div>
  );
}

function AppointmentCard({ slug, appt, language, t, onCancelled }: { slug: string; appt: ClientAppointmentDto; language: Language; t: (k: string, p?: Record<string, string | number>) => string; onCancelled: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const money = (amount: number) => formatMoney(amount, appt.business.currency as Currency);

  async function doCancel() {
    setCancelling(true);
    setCancelError('');
    try {
      await publicApi.accountCancelAppointment(slug, appt.id);
      onCancelled();
    } catch (err) {
      setCancelError(accountErrorMessage(t, err));
    } finally {
      setCancelling(false);
      setConfirming(false);
    }
  }

  return (
    <div className={`xp-appt-card is-${appt.status}`}>
      <div className="xp-appt-top">
        <span className={`xp-appt-badge is-${appt.status}`}>
          <span className="xp-dot" aria-hidden="true" />
          {t(APPT_STATUS_KEY[appt.status])}
        </span>
        <span className="xp-appt-price">{money(appt.totalPrice)}</span>
      </div>

      <h3 className="xp-appt-date">{upperFirst(formatDay(localDate(appt.startsAt, appt.business.timezone), language, { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>

      <div className="xp-appt-meta">
        <span className="xp-appt-meta-row">
          <Icon name="clock" size={15} /> {formatClock(localTime(appt.startsAt, appt.business.timezone), language)}
        </span>
        <span className="xp-appt-meta-row">
          <Icon name="user" size={15} /> {t('pub_my_account_appt_with', { name: appt.professionalName })}
        </span>
      </div>

      <p className="xp-appt-items">{appt.items.map((item) => item.name).join(' + ')}</p>

      {expanded ? (
        <div className="xp-appt-details">
          <div className="xp-appt-detail-row">
            <span>{t('pub_account_phone_label')}</span>
            <span>{appt.business.phone ?? '—'}</span>
          </div>
          <div className="xp-appt-detail-row">
            <span>{appt.business.address}</span>
          </div>
          <ul className="xp-appt-item-list">
            {appt.items.map((item, i) => (
              <li key={i} className="xp-appt-detail-row">
                <span>{item.name}</span>
                <span>{money(item.price)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cancelError ? (
        <p className="xp-error" role="alert">
          {cancelError}
        </p>
      ) : null}

      {confirming ? (
        <div className="xp-appt-confirm">
          <p className="xp-hint">
            <strong>{t('pub_my_account_appt_cancel_confirm_title')}</strong> {t('pub_my_account_appt_cancel_confirm_text')}
          </p>
          <div className="xp-btn-row">
            <Button variant="ghost" full={false} onClick={() => setConfirming(false)}>
              {t('pub_my_account_appt_cancel_keep')}
            </Button>
            <Button variant="danger" full={false} loading={cancelling} onClick={() => void doCancel()}>
              {t('pub_my_account_appt_cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="xp-appt-actions">
          <Button variant="ghost" size="sm" full={false} onClick={() => setExpanded((v) => !v)}>
            {t(expanded ? 'pub_my_account_appt_hide_details' : 'pub_my_account_appt_details')}
          </Button>
          {appt.canCancel ? (
            <Button variant="secondary" size="sm" full={false} onClick={() => setConfirming(true)}>
              {t('pub_my_account_appt_cancel')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
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
      setError(accountErrorMessage(t, err));
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
  const [birthDate, setBirthDate] = useState(account.birthDate ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  const [pwError, setPwError] = useState('');

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');

  async function uploadPhoto(file: File) {
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const updated = await publicApi.accountUploadPhoto(slug, file);
      onAccountChange(updated);
    } catch (err) {
      setPhotoError(accountErrorMessage(t, err));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      // La fecha se envía tal como está en el formulario (cargado con la actual): vacía = quitarla a propósito.
      const updated = await publicApi.accountUpdate(slug, { name, email: email || null, birthDate: birthDate || null });
      onAccountChange(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(accountErrorMessage(t, err));
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
      setPwError(accountErrorMessage(t, err));
    } finally {
      setPwBusy(false);
    }
  }

  async function doDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      await publicApi.accountDelete(slug, deletePassword);
      onLogout();
      navigate(profilePath(slug));
    } catch (err) {
      setDeleteError(accountErrorMessage(t, err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="xp-stack">
      <div className="xp-card xp-stack">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Avatar src={account.photoUrl} name={account.name} size={96} busy={photoBusy} pickLabel={t(account.photoUrl ? 'pub_account_photo_change' : 'pub_account_photo_add')} onPick={(file) => void uploadPhoto(file)} />
        </div>
        {photoError ? (
          <p className="xp-error" role="alert" style={{ textAlign: 'center' }}>
            {photoError}
          </p>
        ) : null}
        <form className="xp-stack" onSubmit={(e) => void saveProfile(e)}>
          {saveError ? (
            <p className="xp-error" role="alert">
              {saveError}
            </p>
          ) : null}
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
          <div className="xp-field">
            <label className="xp-label" htmlFor="xp-prof-birth">
              {t('pub_birth_date')}
            </label>
            <input id="xp-prof-birth" className="xp-input" type="date" autoComplete="bday" min="1900-01-01" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} aria-describedby="xp-prof-birth-hint" />
            <p id="xp-prof-birth-hint" className="xp-hint">
              {t('pub_birth_date_hint')}
            </p>
            {birthDate ? (
              <button type="button" className="xp-link-btn" onClick={() => setBirthDate('')}>
                {t('pub_birth_date_remove')}
              </button>
            ) : null}
          </div>
          <Button loading={saving} full={false} type="submit">
            {t('pub_my_account_save')}
          </Button>
          {saved ? <span className="xp-hint">{t('pub_my_account_saved')}</span> : null}
        </form>
      </div>

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

      <div className="xp-card xp-card--danger xp-stack">
        <h3 className="xp-subtitle xp-subtitle--danger">{t('pub_my_account_delete_cta')}</h3>
        {!confirmDelete ? (
          <>
            <p className="xp-hint">{t('pub_my_account_delete_confirm_text')}</p>
            <Button variant="danger" full={false} onClick={() => setConfirmDelete(true)}>
              {t('pub_my_account_delete_cta')}
            </Button>
          </>
        ) : (
          <>
            <h4 className="xp-subtitle">{t('pub_my_account_delete_confirm_title')}</h4>
            <p className="xp-hint">{t('pub_my_account_delete_confirm_text')}</p>
            {deleteError ? (
              <p className="xp-error" role="alert">
                {deleteError}
              </p>
            ) : null}
            <input className="xp-input" type="password" placeholder={t('pub_account_password_label')} value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
            <div className="xp-btn-row">
              <Button variant="ghost" full={false} onClick={() => setConfirmDelete(false)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" full={false} loading={deleting} onClick={() => void doDelete()}>
                {t('pub_my_account_delete_cta')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
