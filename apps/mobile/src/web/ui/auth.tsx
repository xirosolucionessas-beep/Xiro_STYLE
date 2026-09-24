import { useEffect, useId, useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { supportMailtoUrl, supportMessage, supportWhatsappUrl, XIRO_CONTACT } from '../config/contact.web';
import { Ico } from '../icons';
import { OTP_LENGTH, cleanOtp, pasteInto } from '../otp';
import { passwordRuleStatus, passwordStrength } from '../password';
import { Button } from './Button';
import { cx, useWebStyles } from './shared';

type T = (key: string) => string;

/* ---------- Página de autenticación: columna centrada con logo arriba ---------- */

export function AuthPage({ title, subtitle, logo, children, footer, titleRef }: { title: string; subtitle?: string; logo: ReactNode; children: ReactNode; footer?: ReactNode; titleRef?: Ref<HTMLHeadingElement> }) {
  useWebStyles();
  const titleId = useId();
  return (
    <div className="xw-auth">
      <div className="xw-auth-in">
        <div className="xw-auth-logo" aria-hidden="true">
          {logo}
        </div>
        <section className="xw-acard" aria-labelledby={titleId}>
          <h1 id={titleId} className="xw-atitle" ref={titleRef} tabIndex={-1}>
            {title}
          </h1>
          {subtitle ? <p className="xw-asub">{subtitle}</p> : null}
          {children}
        </section>
        {footer}
      </div>
    </div>
  );
}

/** Botón de texto "← Volver…". */
export function BackLink({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Button variant="ghost" fullWidth icon={<Ico name="arrow-left" size={18} />} onPress={onPress}>
      {children}
    </Button>
  );
}

/** Enlace interno que navega sin recargar (respeta clic con modificador / botón central). */
export function AppLink({ href, onNavigate, children, className }: { href: string; onNavigate: () => void; children: ReactNode; className?: string }) {
  return (
    <a
      className={className ?? 'xw-alink'}
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate();
      }}>
      {children}
    </a>
  );
}

/** Pie de soporte: WhatsApp y correo oficiales (única fuente: config/contact.web.ts). */
export function SupportLinks({ t, language, heading }: { t: T; language: 'es' | 'en'; heading?: string }) {
  useWebStyles();
  return (
    <div className="xw-wsupport">
      <p className="xw-wsupport-title">{heading ?? t('support_heading')}</p>
      <div className="xw-wsupport-links">
        <a
          className="xw-wlink"
          href={supportWhatsappUrl(supportMessage(language))}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t('support_whatsapp_label')}: ${XIRO_CONTACT.whatsappDisplay} (${t('opens_new_tab')})`}>
          <Ico name="message-circle" size={18} />
          <span>{XIRO_CONTACT.whatsappDisplay}</span>
        </a>
        <a className="xw-wlink" href={supportMailtoUrl()} aria-label={`${t('support_email_label')}: ${XIRO_CONTACT.email}`}>
          <Ico name="mail" size={18} />
          <span>{XIRO_CONTACT.email}</span>
        </a>
      </div>
    </div>
  );
}

/* ---------- Casilla ---------- */

export function Checkbox({ checked, onChange, children, error, name }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; error?: string; name?: string }) {
  useWebStyles();
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="xw-check-wrap">
      <div className="xw-check">
        <input id={id} name={name} type="checkbox" checked={checked} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)} />
        <label htmlFor={id}>{children}</label>
      </div>
      <p className="xw-error" id={errorId} aria-live="polite">
        {error ? (
          <>
            <Ico name="triangle-alert" size={16} />
            <span>{error}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

/* ---------- Grupo de opciones (radios nativos): tipo de negocio, canal de envío… ---------- */

export interface RadioOption<V extends string> {
  value: V;
  label: string;
  /** Segunda línea (p. ej. el contacto enmascarado). */
  description?: string;
  icon?: ReactNode;
  /** `success`: selección en verde (p. ej. WhatsApp). */
  tone?: 'success';
}

export function RadioGroup<V extends string>({ label, name, value, onChange, options, variant = 'pill', hideLabel }: { label: string; name: string; value: V; onChange: (value: V) => void; options: Array<RadioOption<V>>; variant?: 'pill' | 'card'; hideLabel?: boolean }) {
  useWebStyles();
  const legendId = useId();
  return (
    <div className="xw-rg">
      <span id={legendId} className={hideLabel ? 'xw-sr' : 'xw-label'}>
        {label}
      </span>
      <div className={cx('xw-rg-list', variant === 'card' && 'xw-rg-list--card')} role="radiogroup" aria-labelledby={legendId}>
        {options.map((option) => (
          <label key={option.value} className={cx('xw-rcard', variant === 'card' ? 'xw-rcard--card' : 'xw-rcard--pill', option.tone === 'success' && 'xw-rcard--success')}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.icon ? <span className="xw-rcard-ic">{option.icon}</span> : null}
            <span className="xw-rcard-text">
              <span className="xw-rcard-label">{option.label}</span>
              {option.description ? <span className="xw-rcard-desc">{option.description}</span> : null}
            </span>
            {variant === 'card' ? (
              <span className="xw-rcard-check" aria-hidden="true">
                <Ico name="check" size={16} />
              </span>
            ) : null}
          </label>
        ))}
      </div>
    </div>
  );
}

/* ---------- Indicador de pasos ---------- */

export function Stepper({ current, total, label, name }: { current: number; total: number; label: string; name: string }) {
  useWebStyles();
  return (
    <div className="xw-stepper">
      <p className="xw-stepper-label" aria-live="polite">
        {label}
        <span className="xw-sr">{`: ${name}`}</span>
      </p>
      <div className="xw-stepper-bar" role="progressbar" aria-label={label} aria-valuemin={1} aria-valuemax={total} aria-valuenow={current} aria-valuetext={label}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cx('xw-stepper-dot', i < current && 'is-done')} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Contraseña: reglas en vivo y medidor de fortaleza ---------- */

export function PasswordChecklist({ value, t, showMeter }: { value: string; t: T; showMeter?: boolean }) {
  useWebStyles();
  const rules = passwordRuleStatus(value);
  const strength = passwordStrength(value);
  const strengthLabel = ['', t('strength_weak'), t('strength_fair'), t('strength_good'), t('strength_strong')][strength]!;
  return (
    <div className="xw-pw">
      <ul className="xw-pw-rules" aria-label={t('password_hint')}>
        {rules.map((rule) => (
          <li key={rule.id} className={cx('xw-pw-rule', rule.met && 'is-met')}>
            <span className="xw-pw-rule-ic" aria-hidden="true">
              <Ico name={rule.met ? 'circle-check' : 'clock'} size={16} />
            </span>
            <span>{t(`pw_rule_${rule.id}`)}</span>
            <span className="xw-sr">{`: ${rule.met ? t('rule_met') : t('rule_pending')}`}</span>
          </li>
        ))}
      </ul>
      {showMeter ? (
        <div className="xw-pw-meter-wrap">
          <div className="xw-pw-meter" role="meter" aria-label={t('strength_label')} aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength} aria-valuetext={strengthLabel || t('strength_empty')}>
            {[1, 2, 3, 4].map((step) => (
              <span key={step} className={cx('xw-pw-seg', strength >= step && `is-on s${strength}`)} />
            ))}
          </div>
          <span className="xw-pw-meter-text" aria-hidden="true">
            {strengthLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Código de 6 dígitos ---------- */

export function OtpInput({ value, onChange, label, digitLabel, disabled, error }: { value: string; onChange: (value: string) => void; label: string; digitLabel: (index: number, total: number) => string; disabled?: boolean; error?: boolean }) {
  useWebStyles();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? '');

  // Foco inicial en la primera casilla vacía (sin `autoFocus` para no descolocar a lectores de pantalla en otras vistas).
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const commit = (next: string[], focus: number) => {
    onChange(next.join('').slice(0, OTP_LENGTH));
    refs.current[Math.max(0, Math.min(focus, OTP_LENGTH - 1))]?.focus();
  };

  const onInput = (index: number, raw: string) => {
    let clean = cleanOtp(raw);
    // Escribir sobre una casilla que ya tenía un dígito (sin seleccionarlo) deja dos: vale el nuevo.
    if (clean.length === 2 && digits[index]) clean = clean[1]!;
    if (!clean) {
      const next = [...digits];
      next[index] = '';
      return commit(next, index);
    }
    // Varios dígitos de golpe (autocompletado del navegador / SMS) se reparten; uno solo avanza a la siguiente casilla.
    const { digits: next, focus } = pasteInto(digits, index, clean);
    commit(next, focus);
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      commit(next, index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  };

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const { digits: next, focus } = pasteInto(digits, index, event.clipboardData.getData('text'));
    commit(next, focus);
  };

  return (
    <div className="xw-otp" role="group" aria-label={label}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          className={cx('xw-otp-box', error && 'is-invalid')}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={OTP_LENGTH}
          value={digit}
          disabled={disabled}
          aria-label={digitLabel(index + 1, OTP_LENGTH)}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onInput(index, event.target.value)}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={(event) => onPaste(index, event)}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}

/** Mensaje de error/aviso anunciable dentro de una tarjeta. */
export function FormMessage({ children, tone = 'error' }: { children?: ReactNode; tone?: 'error' | 'info' }) {
  return (
    <p className={cx('xw-fmsg', tone === 'info' && 'xw-fmsg--info')} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
