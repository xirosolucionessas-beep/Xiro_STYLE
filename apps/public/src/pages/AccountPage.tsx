import { isValidPhone, translate, type ClientAccountDto, type Language } from '@xiro/shared';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { publicApi } from '../api';
import { accountErrorMessage as errorMessage } from '../lib/accountErrors';
import { useAsync } from '../lib/useAsync';
import { accountPath, navigate, profilePath, type AccountView } from '../lib/route';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/** Si el navegador lo permite, le ofrece guardar la contraseña recién usada (8.6 del encargo). Nunca rompe nada si falla o no existe. */
async function offerToSaveCredential(phone: string, password: string): Promise<void> {
  try {
    const PasswordCredentialCtor = (window as unknown as { PasswordCredential?: new (data: { id: string; password: string }) => Credential }).PasswordCredential;
    if (!PasswordCredentialCtor || !navigator.credentials?.store) return;
    await navigator.credentials.store(new PasswordCredentialCtor({ id: phone, password }));
  } catch {
    /* mejor esfuerzo: sin soporte, o la persona lo rechazó */
  }
}

interface AccountPageProps {
  slug: string;
  view: AccountView;
  language: Language;
  account: ClientAccountDto | null | undefined;
  onAuthenticated: (account: ClientAccountDto) => void;
}

/** Ingresar, crear cuenta o recuperar el acceso — siempre con "Continuar sin cuenta" visible: nunca es obligatorio. */
export function AccountPage({ slug, view, language, account, onAuthenticated }: AccountPageProps) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const profileState = useAsync(() => publicApi.profile(slug), [slug]);
  const profile = profileState.data;

  // Con sesión ya iniciada, no tiene sentido mostrar el formulario de ingreso/registro: directo al negocio.
  useEffect(() => {
    if (account && (view === 'ingresar' || view === 'registro')) navigate(profilePath(slug));
  }, [account, slug, view]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Foto de perfil (opcional) elegida en el registro: se sube DESPUÉS de crear la cuenta (ya con sesión), igual que
  // el logo del negocio en el registro del dueño — una subida multipart no se mezcla con el cuerpo JSON del alta.
  // Vista previa como data: URL (no blob:): la CSP de esta página solo permite img-src 'self' data:.
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const pickPhoto = (file: File) => {
    setPhoto(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  // Recuperación: pasos locales (teléfono → código → nueva contraseña), todo bajo la ruta "recuperar".
  const [recoverStep, setRecoverStep] = useState<'phone' | 'code' | 'password' | 'done'>('phone');
  const [recoverPhone, setRecoverPhone] = useState('');
  const [recoverCode, setRecoverCode] = useState('');
  const [recoverDevCode, setRecoverDevCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!isValidPhone(phone)) {
      setError(t('phone_invalid'));
      return;
    }
    setBusy(true);
    try {
      const result = await publicApi.accountLogin(slug, { phone, password, remember });
      void offerToSaveCredential(phone, password);
      onAuthenticated(result);
      // De vuelta al negocio (no a "Mi cuenta"): con la sesión ya activa, puede agendar sin perder el contexto.
      navigate(profilePath(slug));
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!isValidPhone(phone)) {
      setError(t('phone_invalid'));
      return;
    }
    if (!acceptTerms) {
      setError(t('terms_required'));
      return;
    }
    setBusy(true);
    try {
      let result = await publicApi.accountRegister(slug, { name, phone, password, email: email || undefined, acceptTerms: true, remember });
      if (photo) {
        // Mejor esfuerzo: si la foto falla (red, formato raro), la cuenta ya quedó creada — no se bloquea el registro por esto.
        result = await publicApi.accountUploadPhoto(slug, photo).catch(() => result);
      }
      void offerToSaveCredential(phone, password);
      onAuthenticated(result);
      navigate(profilePath(slug));
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function submitRecoverPhone(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!isValidPhone(recoverPhone)) {
      setError(t('phone_invalid'));
      return;
    }
    setBusy(true);
    try {
      const result = await publicApi.accountRecoverRequest(slug, recoverPhone);
      setRecoverDevCode(result.devCode ?? '');
      setRecoverStep('code');
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function submitRecoverCode(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await publicApi.accountRecoverVerify(slug, recoverPhone, recoverCode);
      setResetToken(result.resetToken);
      setRecoverStep('password');
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function submitRecoverPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await publicApi.accountRecoverReset(slug, resetToken, newPassword);
      setRecoverStep('done');
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, control: ReactNode, hint?: string) => (
    <div className="xp-field">
      <label className="xp-label" htmlFor={id}>
        {label}
      </label>
      {control}
      {hint ? <p className="xp-hint">{hint}</p> : null}
    </div>
  );

  const passwordField = (id: string, label: string, value: string, onChange: (v: string) => void, autoComplete: string) => (
    <div className="xp-field">
      <label className="xp-label" htmlFor={id}>
        {label}
      </label>
      <div className="xp-auth-password-row">
        <input id={id} className="xp-input" type={showPassword ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required minLength={8} maxLength={128} />
        <button type="button" className="xp-auth-password-toggle" onClick={() => setShowPassword((v) => !v)}>
          {showPassword ? t('hide') : t('show')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="xp-auth">
      <div className="xp-auth-card">
        {profile?.logoUrl ? (
          <img className="xp-auth-logo" src={profile.logoUrl} alt="" width={96} height={96} />
        ) : (
          <span className="xp-auth-logo xp-auth-logo--fallback" aria-hidden="true">
            {(profile?.name ?? slug).trim().charAt(0).toUpperCase()}
          </span>
        )}
        <h1 className="xp-auth-name">{profile?.name ?? ''}</h1>

        {view !== 'recuperar' ? (
          <div className="xp-seg xp-auth-seg" role="radiogroup" aria-label={t('pub_account_segment_login')}>
            <button type="button" role="radio" aria-checked={view === 'ingresar'} className="xp-seg-btn xp-seg-btn--text" onClick={() => navigate(accountPath(slug, 'ingresar'))}>
              {t('pub_account_segment_login')}
            </button>
            <button type="button" role="radio" aria-checked={view === 'registro'} className="xp-seg-btn xp-seg-btn--text" onClick={() => navigate(accountPath(slug, 'registro'))}>
              {t('pub_account_segment_register')}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="xp-error" role="alert" style={{ marginBottom: 10 }}>
            {error}
          </p>
        ) : null}

        {view === 'ingresar' ? (
          <form className="xp-stack" onSubmit={(e) => void submitLogin(e)} autoComplete="on">
            {field('xp-login-phone', t('pub_account_phone_label'), <input id="xp-login-phone" className="xp-input" type="tel" inputMode="tel" autoComplete="username" required value={phone} onChange={(e) => setPhone(e.target.value)} />)}
            {passwordField('xp-login-password', t('pub_account_password_label'), password, setPassword, 'current-password')}
            <div className="xp-auth-row">
              <label className="xp-check xp-auth-remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>{t('pub_account_remember')}</span>
              </label>
              <a className="xp-auth-forgot" href={accountPath(slug, 'recuperar')} onClick={(e) => (e.preventDefault(), navigate(accountPath(slug, 'recuperar')))}>
                {t('pub_account_forgot_password')}
              </a>
            </div>
            <Button loading={busy} type="submit">
              {t('pub_account_login_cta')}
            </Button>
          </form>
        ) : null}

        {view === 'registro' ? (
          <form className="xp-stack" onSubmit={(e) => void submitRegister(e)} autoComplete="on">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-2)' }}>
              <Avatar src={photoPreview} name={name} size={88} pickLabel={t('pub_account_photo_add')} onPick={pickPhoto} />
            </div>
            {field('xp-reg-name', t('pub_account_name_label'), <input id="xp-reg-name" className="xp-input" type="text" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />)}
            {field('xp-reg-phone', t('pub_account_phone_label'), <input id="xp-reg-phone" className="xp-input" type="tel" inputMode="tel" autoComplete="username" required value={phone} onChange={(e) => setPhone(e.target.value)} />, t('pub_account_phone_hint'))}
            {field('xp-reg-email', t('pub_account_email_label'), <input id="xp-reg-email" className="xp-input" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />)}
            {passwordField('xp-reg-password', t('pub_account_password_label'), password, setPassword, 'new-password')}
            <label className="xp-check">
              <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} required />
              <span>{t('pub_account_accept_terms')}</span>
            </label>
            <label className="xp-check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>{t('pub_account_remember')}</span>
            </label>
            <Button loading={busy} type="submit">
              {t('pub_account_register_cta')}
            </Button>
            <p className="xp-hint" style={{ textAlign: 'center' }}>
              {t('pub_account_register_hint')}
            </p>
          </form>
        ) : null}

        {view === 'recuperar' ? (
          <div className="xp-stack">
            <h2 className="xp-auth-recover-title">{t('pub_account_recover_title')}</h2>
            {recoverStep === 'phone' ? (
              <form className="xp-stack" onSubmit={(e) => void submitRecoverPhone(e)}>
                <p className="xp-hint">{t('pub_account_recover_intro')}</p>
                {field('xp-rec-phone', t('pub_account_phone_label'), <input id="xp-rec-phone" className="xp-input" type="tel" inputMode="tel" autoComplete="tel" required value={recoverPhone} onChange={(e) => setRecoverPhone(e.target.value)} />)}
                <Button loading={busy} type="submit">
                  {t('pub_account_recover_send_code')}
                </Button>
              </form>
            ) : null}
            {recoverStep === 'code' ? (
              <form className="xp-stack" onSubmit={(e) => void submitRecoverCode(e)}>
                {recoverDevCode ? <p className="xp-hint">{t('pub_account_dev_code', { code: recoverDevCode })}</p> : null}
                {field('xp-rec-code', t('pub_account_recover_code_label'), <input id="xp-rec-code" className="xp-input" type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={recoverCode} onChange={(e) => setRecoverCode(e.target.value.replace(/\D/g, ''))} />)}
                <Button loading={busy} type="submit">
                  {t('pub_account_recover_verify')}
                </Button>
                <Button variant="ghost" type="button" onClick={() => setRecoverStep('phone')}>
                  {t('pub_account_recover_resend')}
                </Button>
              </form>
            ) : null}
            {recoverStep === 'password' ? (
              <form className="xp-stack" onSubmit={(e) => void submitRecoverPassword(e)}>
                {passwordField('xp-rec-newpass', t('pub_account_new_password_label'), newPassword, setNewPassword, 'new-password')}
                <Button loading={busy} type="submit">
                  {t('pub_account_recover_submit')}
                </Button>
              </form>
            ) : null}
            {recoverStep === 'done' ? (
              <div className="xp-stack">
                <p className="xp-hint">{t('pub_account_recover_success')}</p>
                <Button onClick={() => navigate(accountPath(slug, 'ingresar'))}>{t('pub_account_segment_login')}</Button>
              </div>
            ) : null}
            <p className="xp-hint xp-auth-backup">{t('pub_account_recover_backup_hint')}</p>
          </div>
        ) : null}

        <Button variant="ghost" full onClick={() => navigate(profilePath(slug))}>
          <Icon name="back" size={16} /> {t('pub_account_continue_guest')}
        </Button>
      </div>
    </div>
  );
}
