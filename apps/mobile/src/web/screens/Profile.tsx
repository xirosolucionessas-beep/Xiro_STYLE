import type { User } from '@xiro/shared';
import { useState } from 'react';
import type { CountryCode } from '../data/countries';
import { DEFAULT_COUNTRY, countryByCode } from '../data/countries';
import { Ico } from '../icons';
import { Button, Input } from '../ui';
import { FormMessage, OtpInput } from '../ui/auth';
import { PhoneField } from '../ui/PhoneField';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;
type ActionResult = { ok: true } | { ok: false; error: string; field?: string };

export interface ProfileViewProps {
  t: T;
  user: User;
  businessName: string;
  onSaveName: (name: string) => Promise<ActionResult>;
  onRequestPhoneChange: (phone: string) => Promise<ActionResult>;
  onConfirmPhoneChange: (code: string) => Promise<ActionResult>;
  onLogout: () => void;
}

type PhoneStep = 'idle' | 'enter' | 'verify';

export function ProfileView({ t, user, businessName, onSaveName, onRequestPhoneChange, onConfirmPhoneChange, onLogout }: ProfileViewProps) {
  useWebStyles();
  const [name, setName] = useState(user.name);
  const [nameError, setNameError] = useState<string>();
  const [savedName, setSavedName] = useState(false);
  const [busyName, setBusyName] = useState(false);

  const [phoneStep, setPhoneStep] = useState<PhoneStep>('idle');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState<string>();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [busyPhone, setBusyPhone] = useState(false);
  const [phoneChanged, setPhoneChanged] = useState(false);

  async function saveName() {
    if (!name.trim()) return setNameError(t('required'));
    setNameError(undefined);
    setSavedName(false);
    setBusyName(true);
    try {
      const result = await onSaveName(name.trim());
      if (result.ok) setSavedName(true);
      else setNameError(result.error);
    } finally {
      setBusyName(false);
    }
  }

  function startPhoneChange() {
    setPhoneStep('enter');
    setPhoneNumber('');
    setPhoneError(undefined);
    setCode('');
    setCodeError(undefined);
    setPhoneChanged(false);
  }
  function cancelPhoneChange() {
    setPhoneStep('idle');
  }

  async function sendPhoneCode() {
    setPhoneError(undefined);
    setBusyPhone(true);
    try {
      const dial = countryByCode(phoneCountry).dial;
      const digits = phoneNumber.replace(/\D/g, '');
      const composed = digits.startsWith(dial) && digits.length > dial.length + 6 ? digits : dial + digits.replace(/^0+/, '');
      const result = await onRequestPhoneChange(composed);
      if (result.ok) setPhoneStep('verify');
      else setPhoneError(result.error);
    } finally {
      setBusyPhone(false);
    }
  }

  async function confirmPhoneCode() {
    if (!/^\d{6}$/.test(code)) return setCodeError(t('code_invalid'));
    setCodeError(undefined);
    setBusyPhone(true);
    try {
      const result = await onConfirmPhoneChange(code);
      if (result.ok) {
        setPhoneStep('idle');
        setPhoneChanged(true);
      } else setCodeError(result.error);
    } finally {
      setBusyPhone(false);
    }
  }

  return (
    <div className="xw-profile-content">
      <div className="xw-profile-field">
        <Input label={t('profile_name_label')} value={name} onChange={setName} error={nameError} autoComplete="name" name="name" maxLength={80} />
        <Button onPress={() => void saveName()} loading={busyName} loadingLabel={t('loading')}>
          {t('save_changes')}
        </Button>
        {savedName ? (
          <p className="xw-note" style={{ marginTop: 'var(--xw-space-2)' }}>
            <Ico name="check" size={16} />
            <span>{t('saved')}</span>
          </p>
        ) : null}
      </div>

      <div className="xw-profile-view">
        <span className="xw-label">{t('email')}</span>
        <p className="xw-profile-value">{user.email ?? '—'}</p>
      </div>

      <div className="xw-profile-view">
        <span className="xw-label">{t('phone')}</span>
        {phoneStep === 'idle' ? (
          <div className="xw-profile-phone-row">
            <p className="xw-profile-value">{user.phone ? `+${user.phone}` : t('phone_none')}</p>
            <Button variant="secondary" size="sm" onPress={startPhoneChange}>
              {t('phone_change_cta')}
            </Button>
          </div>
        ) : null}
        {phoneChanged ? (
          <p className="xw-note" style={{ marginTop: 'var(--xw-space-2)' }}>
            <Ico name="check" size={16} />
            <span>{t('phone_change_success')}</span>
          </p>
        ) : null}

        {phoneStep === 'enter' ? (
          <div className="xw-profile-phone-panel">
            <h2 className="xw-profile-panel-title">{t('phone_change_title')}</h2>
            <PhoneField
              label={t('phone_new_label')}
              country={phoneCountry}
              onCountryChange={setPhoneCountry}
              value={phoneNumber}
              onChange={setPhoneNumber}
              error={phoneError}
              name="newPhone"
              sheetSearchPlaceholder={t('country_search_placeholder')}
              sheetCloseLabel={t('close')}
              sheetNoResultsLabel={t('country_no_results')}
            />
            <div className="xw-profile-phone-actions">
              <Button onPress={() => void sendPhoneCode()} loading={busyPhone} loadingLabel={t('loading')} disabled={!phoneNumber.trim()}>
                {t('phone_change_send_cta')}
              </Button>
              <Button variant="ghost" onPress={cancelPhoneChange} disabled={busyPhone}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        ) : null}

        {phoneStep === 'verify' ? (
          <div className="xw-profile-phone-panel">
            <h2 className="xw-profile-panel-title">{t('phone_change_title')}</h2>
            <p className="xw-hint">{t('phone_change_sent_note')}</p>
            <OtpInput value={code} onChange={setCode} label={t('otp_label')} digitLabel={(i, total) => `${t('otp_digit')} ${i} / ${total}`} error={Boolean(codeError)} disabled={busyPhone} />
            {codeError ? <FormMessage>{codeError}</FormMessage> : null}
            <div className="xw-profile-phone-actions">
              <Button onPress={() => void confirmPhoneCode()} loading={busyPhone} loadingLabel={t('loading')} disabled={!/^\d{6}$/.test(code)}>
                {t('phone_change_confirm_cta')}
              </Button>
              <Button variant="ghost" onPress={() => setPhoneStep('enter')} disabled={busyPhone}>
                {t('phone_change_retry')}
              </Button>
              <Button variant="ghost" onPress={cancelPhoneChange} disabled={busyPhone}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="xw-profile-view">
        <span className="xw-label">{t('business')}</span>
        <p className="xw-profile-value">{businessName}</p>
      </div>

      <Button variant="danger" onPress={onLogout} style={{ marginTop: 'var(--xw-space-6)' }}>
        {t('logout')}
      </Button>
    </div>
  );
}
