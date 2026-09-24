/**
 * Ruta /register SOLO WEB (nativo: register.tsx, sin cambios). Registro en 3 pasos con los mismos endpoints que la app móvil:
 * POST /api/auth/register → PATCH /api/business → PUT /api/business/logo. Presentación en src/web/screens/Register.tsx.
 */
import { useRouter } from 'expo-router';
import { useMemo, useRef, type ComponentProps } from 'react';
import { api, ApiError, setAccessToken } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { setPostAuthRedirect } from '@/lib/postAuthRedirect';
import { useSession } from '@/lib/session';
import { Brand } from '@/ui/Brand';
import { buildBusinessUpdate, buildRegisterPayload, enterWithProgress, runRegistration, type RegistrationDeps, type RegistrationProgress } from '@/web/registration';
import { RegisterView, type FinishResult, type RegisterDraft } from '@/web/screens/Register';
import { photoToFormData } from '@/web/services/imageUpload.web';
import { setSocialSeed, takeSocialSeed } from '@/web/services/socialSeed';
import { useSocialAuth } from '@/web/services/useSocialAuth';
import { useWebText } from '@/web/services/useWebText';

/** Borrador en memoria: sobrevive a ir a "Términos" y volver (sin contraseñas ni foto). */
let draft: RegisterDraft | null = null;
const saveDraft = (next: RegisterDraft) => {
  draft = next;
};

type FinishInput = Parameters<ComponentProps<typeof RegisterView>['onFinish']>[0];

export default function RegisterWeb() {
  const router = useRouter();
  const { signIn } = useSession();
  const { t, language } = useWebText();
  const progress = useRef<RegistrationProgress | undefined>(undefined);
  const seed = useMemo(() => {
    const taken = takeSocialSeed();
    return taken ? { provider: taken.provider, name: taken.profile.name, email: taken.profile.email } : null;
  }, []);
  const { state, start } = useSocialAuth(t, 'signup', (provider, profile) => {
    setSocialSeed({ provider, profile });
    router.replace('/register');
  });

  const deps: RegistrationDeps = {
    register: api.register,
    authorize: setAccessToken,
    updateBusiness: api.updateBusiness,
    uploadLogo: async (photo) => api.uploadLogo(await photoToFormData(photo, 'logo')),
    // Cuenta nueva: primero a elegir plan (con salida a prueba gratis desde ahí), no directo al Dashboard. Se fija
    // ANTES de firmar sesión — runRegistration llama signIn internamente y ese cambio de estado dispara ya el
    // redirect de (auth)/_layout.tsx, así que ponerlo después llegaría tarde.
    signIn: async (session) => {
      setPostAuthRedirect('/subscription');
      await signIn(session);
    },
  };

  async function onFinish({ step1, step2, photo, phoneDial }: FinishInput): Promise<FinishResult> {
    // Hasta que la API acepte el registro con Google/Apple no se puede completar desde esa vía.
    if (seed) return { status: 'failed', fields: {}, general: t('reg_social_unavailable') };
    const outcome = await runRegistration({ payload: buildRegisterPayload(step1, phoneDial), business: buildBusinessUpdate(step2), photo }, deps, progress.current);
    if (outcome.status === 'done') {
      draft = null;
      return { status: 'done' };
    }
    if (outcome.status === 'partial') {
      progress.current = outcome.progress;
      return { status: 'partial', failed: outcome.failed };
    }
    const result = apiErrors(outcome.error, t);
    // Correo o celular ya registrados: el mensaje va en ese campo (el paso 1) y no como aviso suelto en el paso 3.
    if (outcome.error instanceof ApiError && outcome.error.code === 'account_exists') {
      return { status: 'failed', fields: { [step1.email.trim() ? 'email' : 'phone']: result.general ?? t('unknown_error') } };
    }
    return { status: 'failed', fields: result.fields, general: result.general };
  }

  return (
    <RegisterView
      t={t}
      language={language}
      logo={<Brand size={56} />}
      seed={seed}
      initialDraft={draft}
      onDraftChange={saveDraft}
      onFinish={onFinish}
      onEnterAnyway={async () => {
        if (progress.current) await enterWithProgress(progress.current, deps);
      }}
      onGoLogin={() => router.replace('/login')}
      onTerms={() => router.push('/terms')}
      onPrivacy={() => router.push('/privacy')}
      onBackToStart={() => router.replace('/welcome')}
      social={state}
      onSocial={(provider) => void start(provider)}
    />
  );
}
