import { BUSINESS_TYPES, type BusinessType } from '@xiro/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_COUNTRY, countryByCode, type CountryCode } from '../data/countries';
import { Ico, type IconName } from '../icons';
import { initialHours } from '../hours';
import { validateStep1, validateStep2, type PhotoInput, type SocialSeed, type Step1Values, type Step2Values } from '../registration';
import type { SocialProvider } from '../services/socialAuth.web';
import type { SocialUiState } from '../services/useSocialAuth';
import { Button, Input } from '../ui';
import { AppLink, AuthPage, BackLink, Checkbox, FormMessage, PasswordChecklist, RadioGroup, Stepper } from '../ui/auth';
import { CountryPicker } from '../ui/CountryPicker';
import { HoursEditor } from '../ui/HoursEditor';
import { PhoneField } from '../ui/PhoneField';
import { PhotoPicker, type PickedPhoto } from '../ui/PhotoPicker';
import { SocialButtons } from '../ui/SocialButtons';

/** Resultado de intentar finalizar (lo resuelve el contenedor con la API). */
export type FinishResult =
  | { status: 'done' }
  /** Error antes de crear la cuenta: campos (nombres de campo → texto ya traducido) y mensaje general. */
  | { status: 'failed'; fields: Record<string, string>; general?: string }
  /** La cuenta ya existe, pero falló guardar el negocio o la foto: se puede reintentar o entrar así. */
  | { status: 'partial'; failed: 'business' | 'logo' };

export interface RegisterDraft {
  step: 1 | 2 | 3;
  name: string;
  businessName: string;
  businessType: BusinessType;
  email: string;
  phone: string;
  phoneCountry: CountryCode;
  country: CountryCode;
  address: string;
  city: string;
  hours: Step2Values['hours'];
}

export interface RegisterViewProps {
  t: (key: string) => string;
  language: 'es' | 'en';
  logo: ReactNode;
  /** Precarga desde Google/Apple (nombre y correo; el proveedor puede no entregarlos). */
  seed?: SocialSeed | null;
  /** Borrador guardado en memoria al ir a "Términos" y volver (sin contraseñas ni foto). */
  initialDraft?: RegisterDraft | null;
  onDraftChange?: (draft: RegisterDraft) => void;
  onFinish: (data: { step1: Step1Values; step2: Step2Values; photo: PhotoInput | null; phoneDial: string }) => Promise<FinishResult>;
  /** Entrar con lo ya guardado tras un `partial`. */
  onEnterAnyway: () => Promise<void>;
  onGoLogin: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
  onBackToStart: () => void;
  social: SocialUiState;
  onSocial: (provider: SocialProvider) => void;
}

const BUSINESS_TYPE_ICONS: Record<BusinessType, IconName> = {
  barbershop: 'scissors',
  beauty_salon: 'star',
  spa: 'droplet',
  nails: 'nail-polish',
  other: 'store',
};

const initialStep2 = (draft?: RegisterDraft | null): Step2Values => ({
  address: draft?.address ?? '',
  city: draft?.city ?? '',
  country: draft?.country ?? DEFAULT_COUNTRY,
  hours: draft?.hours ?? initialHours(),
});

/** Registro web en 3 pasos: cuenta → negocio (país, horario) → foto opcional. */
export function RegisterView({ t, language, logo, seed, initialDraft, onDraftChange, onFinish, onEnterAnyway, onGoLogin, onTerms, onPrivacy, onBackToStart, social, onSocial }: RegisterViewProps) {
  // Siempre se retoma en el paso 1: "Términos" solo se abre desde allí y las contraseñas no se conservan.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [s1, setS1] = useState({
    name: initialDraft?.name ?? seed?.name ?? '',
    businessName: initialDraft?.businessName ?? '',
    businessType: (initialDraft?.businessType ?? 'barbershop') as BusinessType,
    email: initialDraft?.email ?? seed?.email ?? '',
    phone: initialDraft?.phone ?? '',
    phoneCountry: initialDraft?.phoneCountry ?? DEFAULT_COUNTRY,
    password: '',
    confirm: '',
  });
  const [accepted, setAccepted] = useState(false);
  const [s2, setS2] = useState<Step2Values>(() => initialStep2(initialDraft));
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState<'business' | 'logo' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const country = countryByCode(s2.country);
  const phoneCountry = countryByCode(s1.phoneCountry);
  const step1Values: Step1Values = { ...s1, accepted, language, social: seed ?? undefined };
  // Los errores se guardan ya traducidos (los de validación llegan como claves; los de la API, como texto).
  const translated = (found: Record<string, string>) => Object.fromEntries(Object.entries(found).map(([field, key]) => [field, t(key)]));
  const fieldError = (field: string) => errors[field];
  const setField = (key: keyof typeof s1) => (value: string) => setS1((current) => ({ ...current, [key]: value }));
  // Al escribir en un campo con error, el aviso desaparece de inmediato (no hace falta volver a intentar Continuar).
  const clearError = (field: string) => setErrors((current) => (current[field] ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)) : current));

  // Guarda el borrador (sin contraseñas ni foto) para no perder lo escrito al abrir "Términos".
  useEffect(() => {
    onDraftChange?.({ step, name: s1.name, businessName: s1.businessName, businessType: s1.businessType, email: s1.email, phone: s1.phone, phoneCountry: s1.phoneCountry, country: s2.country, address: s2.address, city: s2.city, hours: s2.hours });
  }, [step, s1.name, s1.businessName, s1.businessType, s1.email, s1.phone, s1.phoneCountry, s2, onDraftChange]);

  // Al cambiar de paso el foco pasa al título (el lector de pantalla anuncia el paso nuevo).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const goTo = (next: 1 | 2 | 3) => {
    setErrors({});
    setGeneral(undefined);
    setStep(next);
  };

  const next1 = () => {
    const found = validateStep1(step1Values, phoneCountry.dial);
    setErrors(translated(found));
    if (Object.keys(found).length === 0) goTo(2);
  };
  const next2 = () => {
    const found = validateStep2(s2);
    setErrors(translated(found));
    if (Object.keys(found).length === 0) {
      goTo(3);
      return;
    }
    // Enfoca el primer campo con error, en el orden en que aparecen en el formulario.
    const firstField = ['address', 'city', 'hours'].find((field) => found[field]);
    if (firstField) document.querySelector<HTMLElement>(`[name="${firstField}"]`)?.focus();
  };

  async function finish(withPhoto: boolean) {
    setGeneral(undefined);
    setPartial(null);
    setBusy(true);
    try {
      const result = await onFinish({ step1: step1Values, step2: s2, photo: withPhoto && photo ? { uri: photo.uri, width: photo.width } : null, phoneDial: phoneCountry.dial });
      if (result.status === 'partial') setPartial(result.failed);
      if (result.status === 'failed') {
        // Un error de campo del paso 1 devuelve a ese paso; los demás se muestran aquí.
        const step1Fields = Object.keys(result.fields).some((f) => ['name', 'businessName', 'email', 'phone', 'password', 'acceptTerms'].includes(f));
        setErrors(result.fields);
        setGeneral(result.general);
        if (step1Fields) setStep(1);
      }
    } finally {
      setBusy(false);
    }
  }

  const stepLabel = `${t('step_word')} ${step} ${t('step_of')} 3`;
  const titles: Record<1 | 2 | 3, { title: string; subtitle: string }> = {
    1: { title: t('create_account_title'), subtitle: t('create_account_sub') },
    2: { title: t('reg_title_2'), subtitle: `${stepLabel} · ${t('reg_sub_2')}` },
    3: { title: t('reg_title_3'), subtitle: `${stepLabel} · ${t('reg_sub_3')}` },
  };

  return (
    <AuthPage title={titles[step].title} subtitle={titles[step].subtitle} logo={logo} titleRef={heading}>
      <Stepper current={step} total={3} label={stepLabel} name={t(`step_name_${step}`)} />

      {step === 1 ? (
        <form
          className="xw-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            next1();
          }}>
          <SocialButtons t={t} intent="signup" state={social} onSocial={onSocial} />
          <div className="xw-divider">{t('or_with_email')}</div>
          {seed ? <p className="xw-note">{t('social_signup_note')}</p> : null}

          <div className="xw-field-pair">
            <Input label={t('full_name')} value={s1.name} onChange={setField('name')} error={fieldError('name')} autoComplete="name" name="name" />
            <Input label={t('business_name')} value={s1.businessName} onChange={setField('businessName')} error={fieldError('businessName')} autoComplete="organization" name="businessName" />
          </div>
          <RadioGroup
            label={t('business_type')}
            name="businessType"
            value={s1.businessType}
            onChange={(businessType) => setS1((current) => ({ ...current, businessType }))}
            options={BUSINESS_TYPES.map((type) => ({ value: type, label: t(`type_${type}`), icon: <Ico name={BUSINESS_TYPE_ICONS[type]} size={18} /> }))}
          />
          <Input label={t('email')} value={s1.email} onChange={setField('email')} error={fieldError('email')} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} name="email" />
          <PhoneField
            label={t('phone')}
            country={s1.phoneCountry}
            onCountryChange={(phoneCountry) => setS1((current) => ({ ...current, phoneCountry }))}
            value={s1.phone}
            onChange={setField('phone')}
            error={fieldError('phone')}
            required
            name="phone"
            sheetSearchPlaceholder={t('country_search_placeholder')}
            sheetCloseLabel={t('close')}
            sheetNoResultsLabel={t('country_no_results')}
          />
          {!seed ? (
            <>
              <Input label={t('password')} value={s1.password} onChange={setField('password')} error={fieldError('password')} type="password" autoComplete="new-password" name="password" showPasswordLabel={t('show_password')} hidePasswordLabel={t('hide_password')} />
              <PasswordChecklist value={s1.password} t={t} />
              <Input label={t('confirm_password')} value={s1.confirm} onChange={setField('confirm')} error={fieldError('confirm')} type="password" autoComplete="new-password" name="confirm" showPasswordLabel={t('show_password')} hidePasswordLabel={t('hide_password')} />
            </>
          ) : null}
          <Checkbox checked={accepted} onChange={setAccepted} error={fieldError('acceptTerms')} name="acceptTerms">
            {t('accept_terms_pre')}
            <AppLink href="/terms" onNavigate={onTerms}>
              {t('terms_and_conditions')}
            </AppLink>
            {t('accept_terms_mid')}
            <AppLink href="/privacy" onNavigate={onPrivacy}>
              {t('privacy_policy')}
            </AppLink>
          </Checkbox>
          {general ? <FormMessage>{general}</FormMessage> : null}
          <Button type="submit" fullWidth disabled={!accepted}>
            {t('continue')}
          </Button>
          <p className="xw-switch-auth">
            {t('have_account')}{' '}
            <AppLink href="/login" onNavigate={onGoLogin}>
              {t('login')}
            </AppLink>
          </p>
          <BackLink onPress={onBackToStart}>{t('back_to_start')}</BackLink>
        </form>
      ) : null}

      {step === 2 ? (
        <form
          className="xw-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            next2();
          }}>
          <div className="xw-field-pair">
            <Input
              label={t('address')}
              value={s2.address}
              onChange={(address) => {
                setS2({ ...s2, address });
                clearError('address');
              }}
              error={fieldError('address')}
              autoComplete="street-address"
              name="address"
            />
            <Input
              label={t('city')}
              value={s2.city}
              onChange={(city) => {
                setS2({ ...s2, city });
                clearError('city');
              }}
              error={fieldError('city')}
              autoComplete="address-level2"
              name="city"
            />
          </div>
          <CountryPicker
            label={t('country')}
            value={s2.country}
            onChange={(code) => setS2({ ...s2, country: code })}
            hint={`${t('country_prefix_label')} +${country.dial} · ${t('country_currency_label')} ${country.currency}${country.currencyIsFallback ? ` (${t('country_currency_fallback')})` : ''}`}
            sheetSearchPlaceholder={t('country_search_placeholder')}
            sheetCloseLabel={t('close')}
            sheetNoResultsLabel={t('country_no_results')}
          />
          <HoursEditor hours={s2.hours} onChange={(hours) => setS2({ ...s2, hours })} t={t} error={fieldError('hours')} />
          <Button type="submit" fullWidth icon={<Ico name="arrow-right" size={18} />} iconPosition="end">
            {t('continue')}
          </Button>
          <BackLink onPress={() => goTo(1)}>{t('back')}</BackLink>
        </form>
      ) : null}

      {step === 3 ? (
        <div className="xw-form">
          <PhotoPicker photo={photo} onChange={setPhoto} t={t} />
          {general ? <FormMessage>{general}</FormMessage> : null}
          {partial ? (
            <div className="xw-note xw-note--warn" role="alert">
              <p>{t(partial === 'business' ? 'reg_partial_business' : 'reg_partial_logo')}</p>
              <p>{t('reg_partial_hint')}</p>
              <div className="xw-note-actions">
                <Button size="sm" loading={busy} loadingLabel={t('loading')} onPress={() => void finish(true)}>
                  {t('retry')}
                </Button>
                <Button size="sm" variant="secondary" onPress={() => void onEnterAnyway()}>
                  {t('reg_continue_anyway')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button fullWidth loading={busy} loadingLabel={t('loading')} onPress={() => void finish(true)}>
                {t('finish_enter')}
              </Button>
              <Button fullWidth variant="ghost" disabled={busy} onPress={() => void finish(false)}>
                {t('skip_for_now')}
              </Button>
              <BackLink onPress={() => goTo(2)}>{t('back')}</BackLink>
            </>
          )}
        </div>
      ) : null}
    </AuthPage>
  );
}
