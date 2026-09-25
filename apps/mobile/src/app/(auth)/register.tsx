import { defaultBusinessHours } from '@xiro/shared';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { api, setAccessToken } from '@/lib/api';
import { countryByCode } from '@/lib/countries';
import { apiErrors } from '@/lib/forms';
import { pickFromLibrary, takePhotoResult, uploadableImage, type PickedImage } from '@/lib/images';
import { buildBusinessUpdate, buildRegisterPayload, runRegistration, validateStep1, validateStep2 } from '@/lib/registration';
import { DRAFT_KEY, emptyDraft, hasUnsavedInput, parseDraft, serializeDraft, type RegistrationDraft } from '@/lib/registrationDraft';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { prefsStorage, setRememberSession } from '@/lib/storage';
import { AuthShell } from '@/ui/AuthShell';
import { useDialogs } from '@/ui/Dialogs';
import { StepAccount, StepBusiness, StepPhoto, type Secrets } from '@/ui/RegisterSteps';
import { StepBar } from '@/ui/StepBar';
import { AppText } from '@/ui/Text';

/** Campo del formulario ← campo de error que se limpia al editarlo. */
const ERROR_FIELDS: Partial<Record<keyof RegistrationDraft, string[]>> = { accepted: ['acceptTerms'], country: ['phone'] };

/**
 * Registro nativo en 3 pasos, con la MISMA lógica y endpoints que la Web (src/lib/registration.ts):
 * POST /api/auth/register → PATCH /api/business (dirección, ciudad, país, moneda y horario) → PUT /api/business/logo (opcional).
 * Nada se envía hasta "Finalizar y entrar", así no quedan cuentas a medias por abandonar un paso. Si un paso posterior al
 * registro falla, la cuenta ya existe: se entra con lo guardado y se avisa qué completar en Ajustes.
 * El progreso se guarda en el dispositivo (sin la contraseña) para retomarlo si la app se cierra.
 * El método de pago no se pide aquí: la suscripción sigue el estado que devuelve el backend.
 */
export default function Register() {
  const router = useRouter();
  const { t, language } = useSettings();
  const { signIn } = useSession();
  const { toast, confirm } = useDialogs();
  const [draft, setDraft] = useState<RegistrationDraft>(emptyDraft);
  const [secrets, setSecrets] = useState<Secrets>({ password: '', confirm: '' });
  const [logo, setLogo] = useState<PickedImage | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [photoNotice, setPhotoNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const finished = useRef(false);
  const step = draft.step;

  /* ---------- Borrador: se recupera al abrir y se guarda (con pausa) en cada cambio ---------- */
  useEffect(() => {
    let active = true;
    void prefsStorage
      .get(DRAFT_KEY)
      .then((raw) => {
        const saved = parseDraft(raw);
        if (!active || !saved || !hasUnsavedInput(saved)) return;
        setDraft(saved);
        setRestored(true);
      })
      .finally(() => active && setHydrated(true));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || finished.current) return;
    const timer = setTimeout(() => {
      if (finished.current) return;
      void (hasUnsavedInput(draft) ? prefsStorage.set(DRAFT_KEY, serializeDraft(draft)) : prefsStorage.remove(DRAFT_KEY));
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, hydrated]);

  const clearDraft = () => {
    finished.current = true;
    void prefsStorage.remove(DRAFT_KEY);
  };

  /* ---------- Edición ---------- */
  const translate = (keys: Record<string, string>) => Object.fromEntries(Object.entries(keys).map(([field, key]) => [field, t(key)]));
  const dropErrors = (fields: string[]) =>
    setErrors((current) => {
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });

  const change = (patch: Partial<RegistrationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setGeneral(undefined);
    dropErrors(Object.keys(patch).flatMap((key) => [key, ...(ERROR_FIELDS[key as keyof RegistrationDraft] ?? [])]));
  };
  const changeSecrets = (patch: Partial<Secrets>) => {
    setSecrets((current) => ({ ...current, ...patch }));
    dropErrors(['password', 'confirm']);
  };
  const goTo = (next: 1 | 2 | 3) => setDraft((current) => ({ ...current, step: next }));

  const step1Values = () => ({ name: draft.name, businessName: draft.businessName, businessType: draft.businessType, email: draft.email, phone: draft.phone, password: secrets.password, confirm: secrets.confirm, accepted: draft.accepted, language });
  const step2Values = () => ({ address: draft.address, city: draft.city, country: draft.country, hours: draft.hours });
  const dial = countryByCode(draft.country).dial;

  const next1 = () => {
    const found = validateStep1(step1Values(), dial);
    if (Object.keys(found).length > 0) return setErrors(translate(found));
    setErrors({});
    goTo(2);
  };
  const next2 = () => {
    const found = validateStep2(step2Values());
    if (Object.keys(found).length > 0) return setErrors(translate(found));
    setErrors({});
    goTo(3);
  };

  /* ---------- Foto ---------- */
  async function chooseFromGallery() {
    setPhotoNotice(undefined);
    try {
      const [picked] = await pickFromLibrary(1);
      if (picked) setLogo(picked);
    } catch {
      setPhotoNotice(t('reg_gallery_denied'));
    }
  }
  async function takeWithCamera() {
    setPhotoNotice(undefined);
    try {
      const result = await takePhotoResult();
      if (result.status === 'ok') setLogo(result.image);
      else if (result.status === 'denied') setPhotoNotice(t('reg_camera_denied'));
    } catch {
      setPhotoNotice(t('reg_camera_denied'));
    }
  }

  /* ---------- Envío ---------- */
  async function finish(withPhoto: boolean) {
    setGeneral(undefined);
    const step1 = step1Values();
    const step2 = step2Values();
    const first = validateStep1(step1, dial);
    if (Object.keys(first).length > 0) {
      goTo(1);
      return setErrors(translate(first));
    }
    const second = validateStep2(step2);
    if (Object.keys(second).length > 0) {
      goTo(2);
      return setErrors(translate(second));
    }

    setErrors({});
    setBusy(true);
    setRememberSession(true); // un cierre de sesión sin "Recordarme" anterior no debe afectar a esta cuenta nueva
    try {
      const outcome = await runRegistration(
        { payload: buildRegisterPayload(step1, dial), business: buildBusinessUpdate({ ...step2, hours: step2.hours ?? defaultBusinessHours() }), photo: withPhoto ? logo : null },
        {
          register: api.register,
          authorize: setAccessToken,
          updateBusiness: api.updateBusiness,
          uploadLogo: async (photo) => api.uploadLogo(await uploadableImage(photo, 'logo')),
          signIn,
        },
      );
      if (outcome.status === 'done') {
        clearDraft();
      } else if (outcome.status === 'partial') {
        // La cuenta ya existe: se entra con lo guardado (no se registra dos veces) y se avisa qué falta.
        clearDraft();
        toast(t('reg_partial_notice'));
        await signIn(outcome.progress.session);
      } else {
        // Correo o celular ya usados, red caída, etc.: el error se muestra y se vuelve al paso donde se corrige.
        const result = apiErrors(outcome.error, t);
        setErrors(result.fields);
        setGeneral(result.general);
        if (result.fields.email || result.fields.phone || result.fields.name || result.fields.password || result.general === t('account_exists')) goTo(1);
      }
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Salir ---------- */
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/welcome'));
  const back = useCallback(async () => {
    if (busy) return;
    if (step > 1) return goTo((step - 1) as 1 | 2);
    if (!hasUnsavedInput(draft)) {
      clearDraft();
      return leave();
    }
    // El borrador queda guardado: salir no lo pierde, pero se confirma para no sorprender.
    if (await confirm({ title: t('reg_leave_title'), message: t('reg_leave_body'), confirmLabel: t('reg_leave_confirm') })) leave();
  }, [busy, step, draft, confirm, t]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void back();
      return true;
    });
    return () => subscription.remove();
  }, [back]);

  const titles = {
    1: [t('create_account_title'), t('create_account_sub')],
    2: [t('reg_title_2'), t('reg_sub_2')],
    3: [t('reg_title_3'), t('reg_sub_3')],
  } as const;

  return (
    <>
      {/* El gesto de "deslizar para volver" de iOS saltaría la confirmación de salida: aquí se deshabilita. */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      <AuthShell title={titles[step][0]} subtitle={titles[step][1]} onBack={() => void back()}>
        <StepBar step={step} />
        {restored && !secrets.password ? (
          <AppText tone="gold" variant="small" style={{ marginBottom: 12 }} accessibilityLiveRegion="polite">
            {t('reg_draft_restored')}
          </AppText>
        ) : null}
        {general ? (
          <AppText tone="danger" style={{ marginBottom: 12 }} accessibilityLiveRegion="polite">
            {general}
          </AppText>
        ) : null}

        {step === 1 ? <StepAccount draft={draft} secrets={secrets} errors={errors} onChange={change} onSecrets={changeSecrets} onOpenTerms={() => router.push('/terms')} onNext={next1} /> : null}
        {step === 2 ? <StepBusiness draft={draft} errors={errors} onChange={change} onNext={next2} onBack={() => goTo(1)} /> : null}
        {step === 3 ? (
          <StepPhoto logo={logo} notice={photoNotice} busy={busy} onGallery={() => void chooseFromGallery()} onCamera={() => void takeWithCamera()} onRemove={() => setLogo(null)} onFinish={() => void finish(true)} onSkip={() => void finish(false)} onBack={() => goTo(2)} />
        ) : null}
      </AuthShell>
    </>
  );
}
