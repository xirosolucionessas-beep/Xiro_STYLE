import { businessHoursSchema, BUSINESS_TYPES, type BusinessHours, type BusinessType } from '@xiro/shared';
import { COUNTRIES, DEFAULT_COUNTRY, type CountryCode } from './countries';
import { initialHours } from './hours';

/**
 * Borrador del registro nativo: permite retomar el asistente de 3 pasos si la app se cierra a la mitad.
 * NUNCA incluye la contraseña (ni su confirmación): guardarla en el dispositivo sería un riesgo innecesario, así que al
 * retomar se vuelve a pedir. Tampoco guarda la foto (es un archivo temporal). Caduca a los 7 días.
 */
export const DRAFT_KEY = 'xiro.registerDraft';
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_VERSION = 1;

export interface RegistrationDraft {
  step: 1 | 2 | 3;
  name: string;
  businessName: string;
  businessType: BusinessType;
  email: string;
  phone: string;
  country: CountryCode;
  accepted: boolean;
  address: string;
  city: string;
  hours: BusinessHours;
}

export const emptyDraft = (): RegistrationDraft => ({
  step: 1,
  name: '',
  businessName: '',
  businessType: 'barbershop',
  email: '',
  phone: '',
  country: DEFAULT_COUNTRY,
  accepted: false,
  address: '',
  city: '',
  hours: initialHours(),
});

/** ¿Hay algo escrito que se perdería al salir? (Elegir país o tipo, o marcar la casilla, no cuenta.) */
export function hasUnsavedInput(draft: RegistrationDraft): boolean {
  return [draft.name, draft.businessName, draft.email, draft.phone, draft.address, draft.city].some((value) => value.trim().length > 0);
}

export function serializeDraft(draft: RegistrationDraft, now: number = Date.now()): string {
  return JSON.stringify({ v: DRAFT_VERSION, savedAt: now, data: draft });
}

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length <= max ? value : null);

/** Devuelve `null` ante cualquier problema (no existe, caducó, formato distinto o corrupto): nunca lanza. */
export function parseDraft(raw: string | null, now: number = Date.now()): RegistrationDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; data?: Record<string, unknown> };
    if (parsed.v !== DRAFT_VERSION || typeof parsed.savedAt !== 'number' || now - parsed.savedAt > DRAFT_TTL_MS || !parsed.data) return null;
    const d = parsed.data;
    const hours = businessHoursSchema.safeParse(d.hours);
    const [name, businessName, email, phone, address, city] = [text(d.name, 80), text(d.businessName, 80), text(d.email, 254), text(d.phone, 40), text(d.address, 160), text(d.city, 80)];
    if (!hours.success || name === null || businessName === null || email === null || phone === null || address === null || city === null) return null;
    if (d.step !== 1 && d.step !== 2 && d.step !== 3) return null;
    if (!(BUSINESS_TYPES as readonly unknown[]).includes(d.businessType)) return null;
    if (!COUNTRIES.some((country) => country.code === d.country)) return null;
    return { step: d.step, name, businessName, businessType: d.businessType as BusinessType, email, phone, country: d.country as CountryCode, accepted: d.accepted === true, address, city, hours: hours.data };
  } catch {
    return null;
  }
}
