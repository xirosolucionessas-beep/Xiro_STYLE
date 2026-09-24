import { loginSchema } from '@xiro/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { asTranslationKey } from '../registration';
import type { SocialProvider } from '../services/socialAuth.web';
import type { SocialUiState } from '../services/useSocialAuth';
import { Button, Input } from '../ui';
import { AppLink, AuthPage, BackLink, Checkbox, FormMessage, SupportLinks } from '../ui/auth';
import { SocialButtons } from '../ui/SocialButtons';
import type { SubmitResult } from './types';

export interface LoginViewProps {
  t: (key: string) => string;
  language: 'es' | 'en';
  logo: ReactNode;
  onSubmit: (input: { identifier: string; password: string; remember: boolean }) => Promise<SubmitResult>;
  onRecover: () => void;
  onRegister: () => void;
  onBack: () => void;
  social: SocialUiState;
  onSocial: (provider: SocialProvider) => void;
  /** "No encontramos una cuenta…" → continuar al registro con lo que entregó el proveedor. */
  onCreateFromSocial: () => void;
}

/** Pantalla de inicio de sesión web: acceso por correo/teléfono y por Google/Apple, con recuperación y soporte. */
export function LoginView({ t, language, logo, onSubmit, onRecover, onRegister, onBack, social, onSocial, onCreateFromSocial }: LoginViewProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ready = identifier.trim() !== '' && password !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setGeneral(undefined);
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (field && !found[field]) found[field] = t(asTranslationKey(issue.message));
      }
      return setFields(found);
    }
    setFields({});
    setBusy(true);
    try {
      const result = await onSubmit({ identifier: identifier.trim(), password, remember });
      if (!result.ok) {
        setFields(result.fields ?? {});
        setGeneral(result.general);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage title={t('login_secure_title')} subtitle={t('login_sub')} logo={logo} footer={<SupportLinks t={t} language={language} heading={t('login_help')} />}>
      <form onSubmit={(event) => void submit(event)} noValidate className="xw-form">
        <Input label={t('identifier_label')} value={identifier} onChange={setIdentifier} error={fields.identifier} type="text" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} name="identifier" />
        <Input label={t('password')} value={password} onChange={setPassword} error={fields.password} type="password" autoComplete="current-password" name="password" showPasswordLabel={t('show_password')} hidePasswordLabel={t('hide_password')} />
        <Checkbox checked={remember} onChange={setRemember} name="remember">
          {t('remember_me')}
        </Checkbox>
        {general ? <FormMessage>{general}</FormMessage> : null}
        <Button type="submit" fullWidth loading={busy} loadingLabel={t('loading')} disabled={!ready}>
          {t('login')}
        </Button>
      </form>

      <div className="xw-alinks">
        <AppLink href="/recover" onNavigate={onRecover}>
          {t('forgot_password')}
        </AppLink>
      </div>

      <div className="xw-divider">{t('or_sign_in_with')}</div>
      <SocialButtons t={t} intent="signin" state={social} onSocial={onSocial} />

      {social.notFound ? (
        <div className="xw-note" role="status">
          <p>{t('social_err_not_found')}</p>
          <Button size="sm" onPress={onCreateFromSocial}>
            {t('create_account')}
          </Button>
        </div>
      ) : null}

      <p className="xw-switch-auth">
        {t('login_no_account')}{' '}
        <AppLink href="/register" onNavigate={onRegister}>
          {t('create_account')}
        </AppLink>
      </p>
      <BackLink onPress={onBack}>{t('back_to_start')}</BackLink>
    </AuthPage>
  );
}
