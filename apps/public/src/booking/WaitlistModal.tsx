import { formatDay, isValidPhone, looksLikeEmail, publicWaitlistInputSchema, upperFirst, type Language, type PublicBookingProfile } from '@xiro/shared';
import { useState } from 'react';
import { publicApi } from '../api';
import { waitlistPath } from '../lib/route';
import { errorKey } from '../lib/useAsync';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Turnstile } from '../ui/Turnstile';
import type { CustomerForm } from './steps';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * "Avísame si se libera un horario" (Fase 4): para un día sin cupo, la persona deja nombre y celular (prellenados con lo que ya
 * escribió o recordó) y el negocio le avisa si alguien cancela. Con las mismas defensas que una reserva.
 */
export function WaitlistModal({
  slug,
  profile,
  date,
  services,
  professionalId,
  initial,
  language,
  t,
  onClose,
}: {
  slug: string;
  profile: PublicBookingProfile;
  date: string;
  services: string[];
  professionalId: string;
  initial: CustomerForm;
  language: Language;
  t: T;
  onClose: () => void;
}) {
  const [customer, setCustomer] = useState({ firstName: initial.firstName, lastName: initial.lastName, phone: initial.phone, email: initial.email });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [website, setWebsite] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ manageUrl: string } | null>(null);
  const dayLabel = upperFirst(formatDay(date, language, { weekday: 'long', day: 'numeric', month: 'long' }));

  async function submit() {
    const found: Record<string, string> = {};
    if (!customer.firstName.trim()) found.firstName = t('required');
    if (!customer.lastName.trim()) found.lastName = t('required');
    if (!isValidPhone(customer.phone)) found.phone = t('phone_invalid');
    if (customer.email.trim() && !looksLikeEmail(customer.email.trim())) found.email = t('email_invalid');
    if (!acceptTerms) found.acceptTerms = t('terms_required');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const parsed = publicWaitlistInputSchema.safeParse({
      date,
      services,
      professionalId,
      customer: { firstName: customer.firstName.trim(), lastName: customer.lastName.trim(), phone: customer.phone.trim(), email: customer.email.trim() || undefined, notes: '', custom: {} },
      acceptTerms: true,
      website,
      captchaToken,
    });
    if (!parsed.success) return setSubmitError(t('pub_err_fix'));
    setBusy(true);
    setSubmitError(undefined);
    try {
      const result = await publicApi.joinWaitlist(slug, parsed.data);
      setDone({ manageUrl: waitlistPath(slug, result.token) });
    } catch (error) {
      setSubmitError(t(errorKey(error)));
    } finally {
      setBusy(false);
    }
  }

  const cls = (key: string) => `xp-input${errors[key] ? ' has-error' : ''}`;
  const err = (key: string) =>
    errors[key] ? (
      <span className="xp-error" role="alert">
        {errors[key]}
      </span>
    ) : null;

  if (done) {
    return (
      <Modal title={t('pub_waitlist_done_title')} closeLabel={t('close')} onClose={onClose} footer={<Button onClick={onClose}>{t('pub_waitlist_back')}</Button>}>
        <div className="xp-stack xp-waitlist-done">
          <span className="xp-done-icon" aria-hidden="true">
            <Icon name="bell" size={28} />
          </span>
          <p>{t('pub_waitlist_done_text', { day: dayLabel, business: profile.name })}</p>
          <p className="xp-hint">{t('pub_waitlist_done_link_hint')}</p>
          <a className="xp-link-btn" href={done.manageUrl}>
            {t('pub_waitlist_manage_link')}
          </a>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={t('pub_waitlist_title')}
      closeLabel={t('close')}
      onClose={onClose}
      footer={
        <Button loading={busy} loadingLabel={t('loading')} onClick={() => void submit()}>
          {t('pub_waitlist_submit')}
        </Button>
      }>
      <div className="xp-stack">
        <p>{t('pub_waitlist_intro', { day: dayLabel })}</p>
        <div className="xp-grid xp-grid--2">
          <label className="xp-field" htmlFor="xp-wl-first">
            <span className="xp-label">{t('pub_first_name')} *</span>
            <input id="xp-wl-first" className={cls('firstName')} value={customer.firstName} onChange={(e) => setCustomer((c) => ({ ...c, firstName: e.target.value }))} maxLength={50} autoComplete="given-name" aria-invalid={Boolean(errors.firstName)} />
            {err('firstName')}
          </label>
          <label className="xp-field" htmlFor="xp-wl-last">
            <span className="xp-label">{t('pub_last_name')} *</span>
            <input id="xp-wl-last" className={cls('lastName')} value={customer.lastName} onChange={(e) => setCustomer((c) => ({ ...c, lastName: e.target.value }))} maxLength={50} autoComplete="family-name" aria-invalid={Boolean(errors.lastName)} />
            {err('lastName')}
          </label>
        </div>
        <label className="xp-field" htmlFor="xp-wl-phone">
          <span className="xp-label">{t('phone')} *</span>
          <input id="xp-wl-phone" className={cls('phone')} type="tel" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} maxLength={30} autoComplete="tel" aria-invalid={Boolean(errors.phone)} />
          {err('phone')}
        </label>
        <label className="xp-field" htmlFor="xp-wl-email">
          <span className="xp-label">{t('pub_account_email_label')}</span>
          <input id="xp-wl-email" className={cls('email')} type="email" inputMode="email" value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} maxLength={254} autoComplete="email" aria-invalid={Boolean(errors.email)} />
          {err('email')}
        </label>
        <label className="xp-trap" aria-hidden="true">
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
        {profile.captchaSiteKey ? <Turnstile siteKey={profile.captchaSiteKey} onToken={setCaptchaToken} /> : null}
        <label className="xp-check">
          <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} aria-invalid={Boolean(errors.acceptTerms)} />
          <span>{t('pub_waitlist_terms')}</span>
        </label>
        {err('acceptTerms')}
        {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
      </div>
    </Modal>
  );
}
