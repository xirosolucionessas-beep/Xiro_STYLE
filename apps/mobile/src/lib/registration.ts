import {
  businessUpdateSchema,
  isTranslationKey,
  registerSchema,
  type AuthSession,
  type Business,
  type BusinessHours,
  type BusinessType,
  type BusinessUpdateInput,
  type RegisterInput,
} from '@xiro/shared';
import { composePhone, countryByCode, type CountryCode } from './countries';
import { hasHoursErrors } from './hours';

/**
 * Lógica pura del registro web en 3 pasos. Usa los MISMOS esquemas y endpoints que la app móvil:
 * `POST /api/auth/register` → `PATCH /api/business` (paso 2) → `PUT /api/business/logo` (paso 3).
 */

export interface SocialSeed {
  provider: 'google' | 'apple';
  name: string | null;
  email: string | null;
}

export interface Step1Values {
  name: string;
  businessName: string;
  businessType: BusinessType;
  email: string;
  phone: string;
  password: string;
  confirm: string;
  accepted: boolean;
  language: 'es' | 'en';
  /** Si viene de Google/Apple no se pide contraseña. */
  social?: SocialSeed;
}

export interface Step2Values {
  address: string;
  city: string;
  country: CountryCode;
  hours: BusinessHours;
}

/** Los mensajes de los esquemas son claves de traducción; cualquier otro texto cae en "obligatorio". */
export const asTranslationKey = (message: string) => (isTranslationKey(message) ? message : 'required');

export function buildRegisterPayload(values: Step1Values, dial: string): RegisterInput {
  return {
    name: values.name,
    businessName: values.businessName,
    businessType: values.businessType,
    email: values.email.trim() || undefined,
    phone: composePhone(values.phone, dial) || undefined,
    password: values.password,
    acceptTerms: values.accepted as true,
    language: values.language,
  };
}

/** Errores del paso 1 por campo (valores = claves de traducción). Vacío = puede continuar. */
export function validateStep1(values: Step1Values, dial: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const parsed = registerSchema.safeParse(buildRegisterPayload(values, dial));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field && !errors[field]) errors[field] = asTranslationKey(issue.message);
    }
  }
  // El celular es OBLIGATORIO y solo numérico (el esquema compartido lo deja opcional: ahí basta un correo o un celular).
  // Como el celular ya es obligatorio, el correo vuelve a ser opcional: "contact_required" deja de tener sentido.
  if (errors.email === 'contact_required') delete errors.email;
  if (!values.phone.trim() || /\D/.test(values.phone)) errors.phone = 'phone_required';
  if (values.social) {
    delete errors.password; // con cuenta social no hay contraseña
  } else if (values.confirm !== values.password) {
    errors.confirm = 'passwords_mismatch';
  }
  return errors;
}

export function buildBusinessUpdate(values: Step2Values): BusinessUpdateInput {
  const country = countryByCode(values.country);
  return { address: values.address, city: values.city, country: country.name, currency: country.currency, hours: values.hours };
}

/** Mínimos razonables para que "Dirección" y "Ciudad" no pasen con un solo carácter: no hay regla de negocio real detrás, solo evitar entradas vacías de facto. */
const ADDRESS_MIN_LENGTH = 5;
const CITY_MIN_LENGTH = 2;

export function validateStep2(values: Step2Values): Record<string, string> {
  const errors: Record<string, string> = {};
  const parsed = businessUpdateSchema.safeParse(buildBusinessUpdate(values));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field && !errors[field]) errors[field] = asTranslationKey(issue.message);
    }
  }
  // businessUpdateSchema es `.partial()` (se reutiliza para el PATCH parcial de Ajustes): ahí no exige estos campos,
  // así que el registro los exige aquí, en su propia validación, sin tocar el esquema compartido.
  const address = values.address.trim();
  if (!address) errors.address = 'required';
  else if (address.length < ADDRESS_MIN_LENGTH) errors.address = 'address_too_short';
  const city = values.city.trim();
  if (!city) errors.city = 'required';
  else if (city.length < CITY_MIN_LENGTH) errors.city = 'city_too_short';
  if (hasHoursErrors(values.hours)) errors.hours = 'hours_close_after_open';
  return errors;
}

/* ---------- Envío en secuencia, con reintento sin volver a registrar ---------- */

export interface PhotoInput {
  uri: string;
  width: number;
}

export interface RegistrationDeps {
  register: (payload: RegisterInput) => Promise<AuthSession>;
  /** Deja el access token listo para las llamadas siguientes, antes de iniciar sesión en la app. */
  authorize: (accessToken: string) => void;
  updateBusiness: (body: BusinessUpdateInput) => Promise<Business>;
  uploadLogo: (photo: PhotoInput) => Promise<Business>;
  signIn: (session: AuthSession) => Promise<void>;
  /** Se llama UNA vez, cuando la cuenta ya quedó creada (aunque un paso posterior falle). Nunca rompe el registro. */
  onRegistered?: (session: AuthSession) => Promise<void> | void;
}

export interface RegistrationProgress {
  session: AuthSession;
  businessSaved: boolean;
  logoSaved: boolean;
}

export type RegistrationOutcome =
  | { status: 'done' }
  | { status: 'failed'; error: unknown }
  | { status: 'partial'; failed: 'business' | 'logo'; error: unknown; progress: RegistrationProgress };

export interface RegistrationInput {
  payload: RegisterInput;
  business: BusinessUpdateInput;
  photo: PhotoInput | null;
}

/**
 * Registra y completa el negocio. Si un paso posterior al registro falla, la cuenta ya existe: se devuelve `partial` con el
 * progreso para poder reintentar SOLO lo pendiente (nunca se registra dos veces) o entrar sin ello.
 */
export async function runRegistration(input: RegistrationInput, deps: RegistrationDeps, resume?: RegistrationProgress): Promise<RegistrationOutcome> {
  let progress = resume;
  if (!progress) {
    try {
      progress = { session: await deps.register(input.payload), businessSaved: false, logoSaved: false };
    } catch (error) {
      return { status: 'failed', error };
    }
    try {
      await deps.onRegistered?.(progress.session);
    } catch {
      /* un fallo aquí (p. ej. el almacenamiento) no debe deshacer ni frenar una cuenta ya creada */
    }
  }
  deps.authorize(progress.session.accessToken);

  const withBusiness = (business: Business): RegistrationProgress => ({ ...progress!, session: { ...progress!.session, business } });

  if (!progress.businessSaved) {
    try {
      progress = { ...withBusiness(await deps.updateBusiness(input.business)), businessSaved: true };
    } catch (error) {
      return { status: 'partial', failed: 'business', error, progress };
    }
  }
  if (input.photo && !progress.logoSaved) {
    try {
      progress = { ...withBusiness(await deps.uploadLogo(input.photo)), logoSaved: true };
    } catch (error) {
      return { status: 'partial', failed: 'logo', error, progress };
    }
  }
  await deps.signIn(progress.session);
  return { status: 'done' };
}

/** "Continuar sin guardar": entra con lo que ya se guardó (se puede completar luego en Ajustes). */
export async function enterWithProgress(progress: RegistrationProgress, deps: Pick<RegistrationDeps, 'signIn'>): Promise<void> {
  await deps.signIn(progress.session);
}
