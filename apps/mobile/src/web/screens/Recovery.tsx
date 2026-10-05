import { identifierSchema, passwordSchema, type RecoveryChannel } from '@xiro/shared';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { filterPhoneInput, identifierErrorKeyForChannel, isValidIdentifierForChannel } from '@/lib/recovery';
import { WhatsAppLogo } from '../brand/logos';
import { Ico } from '../icons';
import { maskEmail, maskPhone } from '../mask';
import { RESEND_SECONDS, formatCountdown } from '../otp';
import { Button, Input } from '../ui';
import { AuthPage, BackLink, FormMessage, OtpInput, PasswordChecklist, RadioGroup, SupportLinks } from '../ui/auth';
import type { SubmitResult } from './types';

interface BaseProps {
  t: (key: string) => string;
  language: 'es' | 'en';
  logo: ReactNode;
}

/* ---------- 1. Elegir cómo recibir el código ---------- */

export interface RecoverViewProps extends BaseProps {
  onSubmit: (input: { identifier: string; channel: RecoveryChannel }) => Promise<SubmitResult>;
  onBack: () => void;
}

export function RecoverView({ t, language, logo, onSubmit, onBack }: RecoverViewProps) {
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState<RecoveryChannel>('whatsapp');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);
  const isPhoneChannel = channel === 'whatsapp' || channel === 'sms';
  const hasInput = identifier.trim() !== '';
  // Válido para habilitar "Enviar código" — el chequeo estricto (el mismo que aplica el servidor) va en el envío.
  const isValid = isValidIdentifierForChannel(identifier, channel);

  // El canal lo elige la persona (no se adivina por lo que escribe): cambiarlo limpia el campo y cualquier error,
  // porque un celular y un correo no comparten formato ni son intercambiables entre sí.
  const onChannel = (next: RecoveryChannel) => {
    setChannel(next);
    setIdentifier('');
    setFields({});
    setGeneral(undefined);
  };

  const onIdentifier = (value: string) => {
    setIdentifier(isPhoneChannel ? filterPhoneInput(value) : value);
    if (fields.identifier) setFields({});
  };

  const phoneHint = !hasInput ? t('channel_hint_phone') : maskPhone(identifier) || t('channel_hint_phone');
  const emailHint = !hasInput ? t('channel_hint_email') : maskEmail(identifier) || t('channel_hint_email');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setGeneral(undefined);
    if (!isValidIdentifierForChannel(identifier, channel)) return setFields({ identifier: t(identifierErrorKeyForChannel(channel)) });
    // Segunda pasada con el esquema completo (correo o celular, formato final que espera el servidor): así el envío
    // nunca depende solo del chequeo del cliente, aunque ambos coincidan en el caso normal.
    const parsed = identifierSchema.safeParse(identifier);
    if (!parsed.success) return setFields({ identifier: t(identifierErrorKeyForChannel(channel)) });
    setFields({});
    setBusy(true);
    try {
      const result = await onSubmit({ identifier: identifier.trim(), channel });
      if (!result.ok) {
        setFields(result.fields ?? {});
        setGeneral(result.general);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage title={t('recover_title')} subtitle={t('recover_sub')} logo={logo} footer={<SupportLinks t={t} language={language} heading={t('recover_no_access')} />}>
      <form className="xw-form" noValidate onSubmit={(event) => void submit(event)}>
        <RadioGroup
          label={t('recover_how')}
          name="channel"
          variant="card"
          value={channel}
          onChange={onChannel}
          options={[
            { value: 'whatsapp', label: t('channel_whatsapp'), description: phoneHint, icon: <WhatsAppLogo size={26} />, tone: 'success' },
            { value: 'email', label: t('channel_email'), description: emailHint, icon: <Ico name="mail" size={24} /> },
            { value: 'sms', label: t('channel_sms'), description: phoneHint, icon: <Ico name="message-square" size={24} /> },
          ]}
        />
        {isPhoneChannel ? (
          <Input label={t('identifier_label')} value={identifier} onChange={onIdentifier} error={fields.identifier} type="tel" inputMode="tel" maxLength={13} autoComplete="tel" name="identifier" />
        ) : (
          <Input label={t('identifier_label')} value={identifier} onChange={onIdentifier} error={fields.identifier} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} name="identifier" />
        )}
        <p className="xw-note">
          <Ico name="circle-check" size={18} />
          <span>{t('recover_social_note')}</span>
        </p>
        {general ? <FormMessage>{general}</FormMessage> : null}
        <Button type="submit" fullWidth loading={busy} loadingLabel={t('loading')} disabled={!isValid}>
          {t('send_code')}
        </Button>
        <BackLink onPress={onBack}>{t('back_to_login')}</BackLink>
      </form>
    </AuthPage>
  );
}

/* ---------- 2. Verificar el código de 6 dígitos ---------- */

export interface VerifyViewProps extends BaseProps {
  channel: RecoveryChannel;
  /** Solo en desarrollo: la API devuelve el código en la respuesta. */
  devCode?: string;
  onVerify: (code: string) => Promise<SubmitResult>;
  onResend: () => Promise<SubmitResult>;
  onChangeMethod: () => void;
  onBack: () => void;
}

export function VerifyView({ t, language, logo, channel, devCode, onVerify, onResend, onChangeMethod, onBack }: VerifyViewProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [resending, setResending] = useState(false);
  const complete = /^\d{6}$/.test(code);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (!complete) return setError(t('code_invalid'));
    setError(undefined);
    setBusy(true);
    try {
      const result = await onVerify(code);
      if (!result.ok) setError(result.fields?.code ?? result.general);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(undefined);
    setInfo(undefined);
    try {
      const result = await onResend();
      if (result.ok) {
        setInfo(t('resend_done'));
        setCode('');
        setSeconds(RESEND_SECONDS);
      } else setError(result.general);
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthPage title={t('verify_title')} subtitle={t(`verify_sent_${channel}`)} logo={logo} footer={<SupportLinks t={t} language={language} heading={t('recover_no_access')} />}>
      <form className="xw-form" noValidate onSubmit={(event) => void submit(event)}>
        {devCode ? (
          <p className="xw-note xw-note--dev">
            {t('dev_code')} <strong>{devCode}</strong>
          </p>
        ) : null}
        <OtpInput value={code} onChange={setCode} label={t('otp_label')} digitLabel={(i, total) => `${t('otp_digit')} ${i} / ${total}`} error={Boolean(error)} disabled={busy} />
        <p className="xw-error" role="alert">
          {error ? (
            <>
              <Ico name="triangle-alert" size={16} />
              <span>{error}</span>
            </>
          ) : null}
        </p>
        <p className="xw-sr" role="status">
          {info}
        </p>
        <p className="xw-resend">
          {seconds > 0 ? (
            <span>
              {t('resend_in')} <time>{formatCountdown(seconds)}</time>
            </span>
          ) : (
            <button type="button" className="xw-link-btn" disabled={resending} onClick={() => void resend()}>
              {t('resend_code')}
            </button>
          )}
        </p>
        <Button type="submit" fullWidth loading={busy} loadingLabel={t('loading')} disabled={!complete}>
          {t('enter_xiro')}
        </Button>
        <Button variant="secondary" fullWidth onPress={onChangeMethod}>
          {t('change_method')}
        </Button>
        <BackLink onPress={onBack}>{t('back_to_login_long')}</BackLink>
      </form>
    </AuthPage>
  );
}

/* ---------- 3. Nueva contraseña ---------- */

export interface ResetViewProps extends BaseProps {
  onSubmit: (input: { password: string }) => Promise<SubmitResult>;
  onBack: () => void;
}

export function ResetView({ t, language, logo, onSubmit, onBack }: ResetViewProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setGeneral(undefined);
    const found: Record<string, string> = {};
    if (!passwordSchema.safeParse(password).success) found.password = t('password_weak');
    if (confirm !== password) found.confirm = t('passwords_mismatch');
    if (Object.keys(found).length > 0) return setFields(found);
    setFields({});
    setBusy(true);
    try {
      const result = await onSubmit({ password });
      if (!result.ok) {
        setFields(result.fields ?? {});
        setGeneral(result.general);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage title={t('reset_title')} subtitle={t('reset_verified')} logo={logo} footer={<SupportLinks t={t} language={language} />}>
      <form className="xw-form" noValidate onSubmit={(event) => void submit(event)}>
        <Input label={t('password')} value={password} onChange={setPassword} error={fields.password} type="password" autoComplete="new-password" name="password" showPasswordLabel={t('show_password')} hidePasswordLabel={t('hide_password')} />
        <PasswordChecklist value={password} t={t} showMeter />
        <Input label={t('confirm_password')} value={confirm} onChange={setConfirm} error={fields.confirm} type="password" autoComplete="new-password" name="confirm" showPasswordLabel={t('show_password')} hidePasswordLabel={t('hide_password')} />
        {general ? <FormMessage>{general}</FormMessage> : null}
        <Button type="submit" fullWidth loading={busy} loadingLabel={t('loading')} disabled={password === '' || confirm === ''}>
          {t('save_and_enter')}
        </Button>
        <BackLink onPress={onBack}>{t('back_to_login_long')}</BackLink>
      </form>
    </AuthPage>
  );
}
