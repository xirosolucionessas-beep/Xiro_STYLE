import { z } from 'zod';
import { CURRENCIES } from './money';
import { normalizePhone } from './phone';
import { EMPLOYEE_PERMISSIONS, type EmployeePermission, type Role } from './roles';
import { STOCK_STATUSES } from './stock';

/* Validation messages are i18n keys so each client can translate them. */

export const LANGUAGES = ['es', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEMES = ['dark', 'light'] as const;
export type ThemeMode = (typeof THEMES)[number];

export const BUSINESS_TYPES = ['barbershop', 'beauty_salon', 'spa', 'nails', 'other'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const MAX_PHOTOS_PER_ITEM = 4; // 1 principal + 3 de galería (contrato del catálogo público)

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number) => trimmed(max).min(1, 'required');

export const passwordSchema = z
  .string()
  .min(8, 'password_weak')
  .max(128, 'password_weak')
  .regex(/[A-Z]/, 'password_weak')
  .regex(/\d/, 'password_weak');

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('email_invalid'));

export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'phone_invalid' });
      return z.NEVER;
    }
    return normalized;
  });

/** Login / recovery identifier: an email or a phone number. */
export const identifierSchema = z
  .string()
  .trim()
  .min(1, 'required')
  .transform((value, ctx) => {
    if (value.includes('@')) {
      const parsed = emailSchema.safeParse(value);
      if (parsed.success) return { kind: 'email' as const, value: parsed.data };
    } else {
      const normalized = normalizePhone(value);
      if (normalized) return { kind: 'phone' as const, value: normalized };
    }
    ctx.addIssue({ code: 'custom', message: 'identifier_invalid' });
    return z.NEVER;
  });

/* ---------- Auth ---------- */

export const registerSchema = z
  .object({
    name: required(80),
    businessName: required(80),
    businessType: z.enum(BUSINESS_TYPES).default('other'),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    acceptTerms: z.literal(true, { error: 'terms_required' }),
    language: z.enum(LANGUAGES).default('es'),
  })
  .refine((v) => v.email || v.phone, { message: 'contact_required', path: ['email'] });
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1, 'required').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

export const RECOVERY_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type RecoveryChannel = (typeof RECOVERY_CHANNELS)[number];

export const recoverRequestSchema = z.object({
  identifier: identifierSchema,
  channel: z.enum(RECOVERY_CHANNELS).default('email'),
});
export const recoverVerifySchema = z.object({
  identifier: identifierSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'code_invalid'),
});
export const recoverResetSchema = z.object({
  resetToken: z.string().min(20).max(200),
  newPassword: passwordSchema,
});

export const profileUpdateSchema = z
  .object({
    name: required(80),
    language: z.enum(LANGUAGES),
    theme: z.enum(THEMES),
  })
  .partial();

/** Cambio de celular: el número nuevo se verifica con un código de un solo uso antes de aplicarse. */
export const phoneChangeRequestSchema = z.object({ phone: phoneSchema });
export const phoneChangeConfirmSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'code_invalid') });

/* ---------- Business ---------- */

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_invalid');

export const dayHoursSchema = z.object({
  day: z.number().int().min(0).max(6), // 0 = domingo
  open: z.boolean(),
  from: timeSchema,
  to: timeSchema,
});
export type DayHours = z.infer<typeof dayHoursSchema>;

export const businessHoursSchema = z.object({
  sameEveryDay: z.boolean(),
  days: z.array(dayHoursSchema).length(7),
});
export type BusinessHours = z.infer<typeof businessHoursSchema>;

export function defaultBusinessHours(): BusinessHours {
  return {
    sameEveryDay: true,
    days: Array.from({ length: 7 }, (_, day) => ({ day, open: day !== 0, from: '09:00', to: '19:00' })),
  };
}

export const businessUpdateSchema = z
  .object({
    name: required(80),
    type: z.enum(BUSINESS_TYPES),
    whatsapp: phoneSchema.or(z.literal('').transform(() => null)),
    address: trimmed(160),
    city: trimmed(80),
    country: trimmed(80),
    currency: z.enum(CURRENCIES),
    hours: businessHoursSchema,
  })
  .partial();
export type BusinessUpdateInput = z.input<typeof businessUpdateSchema>;

export const cashOpeningSchema = z.object({
  amount: z.number().int().min(0).max(1_000_000_000),
  note: trimmed(200).default(''),
});

/* ---------- Catalog / inventory ---------- */

export const categoryInputSchema = z.object({ name: required(40) });

export const itemInputSchema = z.object({
  name: required(80),
  categoryId: z.string().min(1, 'required'),
  shortDescription: trimmed(120).default(''),
  description: trimmed(1500).default(''),
  detail: trimmed(60).default(''),
  price: z.number().int().min(0).max(1_000_000_000),
  published: z.boolean().default(true),
  referenceCode: trimmed(40).default(''),
  internalUnitCost: z.number().int().min(0).max(1_000_000_000).default(0),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  stockStatus: z.enum(STOCK_STATUSES).optional(),
  internalNotes: trimmed(1000).default(''),
});
export type ItemInput = z.input<typeof itemInputSchema>;

export const clientInputSchema = z.object({
  name: required(80),
  email: emailSchema.or(z.literal('').transform(() => undefined)).optional(),
  phone: phoneSchema.or(z.literal('').transform(() => undefined)).optional(),
  address: trimmed(160).default(''),
  notes: trimmed(1000).default(''),
});
export type ClientInput = z.input<typeof clientInputSchema>;

/* ---------- Fidelización ---------- */

/** `amount` es opcional: si se omite, el servidor usa el precio actual del item elegido. */
export const serviceRecordInputSchema = z.object({
  clientId: z.string().min(1, 'required'),
  itemId: z.string().min(1, 'required'),
  amount: z.number().int().min(0).max(1_000_000_000).optional(),
  note: trimmed(300).default(''),
});
export type ServiceRecordInput = z.input<typeof serviceRecordInputSchema>;

export const loyaltyProgramUpdateSchema = z.object({
  enabled: z.boolean().default(false),
  goal: z.number().int().min(1).max(1000).default(10),
  resetOnRedeem: z.boolean().default(true),
  rewardMessage: trimmed(200).default(''),
  itemIds: z.array(z.string().min(1)).max(300).default([]),
});
export type LoyaltyProgramUpdateInput = z.input<typeof loyaltyProgramUpdateSchema>;

/* ---------- Notificaciones ---------- */

export const notificationSettingsUpdateSchema = z.object({
  enabled: z.boolean(),
  loyaltyEnabled: z.boolean(),
  billingEnabled: z.boolean(),
});
export type NotificationSettingsUpdateInput = z.input<typeof notificationSettingsUpdateSchema>;

const expoPushRegisterSchema = z.object({ platform: z.literal('expo'), token: z.string().min(10).max(400) });
const webPushRegisterSchema = z.object({
  platform: z.literal('web'),
  endpoint: z.string().url().max(600),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export const pushRegisterSchema = z.discriminatedUnion('platform', [expoPushRegisterSchema, webPushRegisterSchema]);
export type PushRegisterInput = z.input<typeof pushRegisterSchema>;

export const pushUnregisterSchema = z.object({ token: z.string().min(1).max(600) });
export type PushUnregisterInput = z.input<typeof pushUnregisterSchema>;

/* ---------- Empleados ---------- */

const permissionsSchema = z.array(z.enum(EMPLOYEE_PERMISSIONS)).max(EMPLOYEE_PERMISSIONS.length);

export const employeeCreateSchema = z
  .object({
    name: required(80),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
    permissions: permissionsSchema.default([]),
  })
  .refine((v) => v.email || v.phone, { message: 'contact_required', path: ['email'] });
export type EmployeeCreateInput = z.input<typeof employeeCreateSchema>;

export const employeeUpdateSchema = z
  .object({
    name: required(80),
    permissions: permissionsSchema,
    active: z.boolean(),
    password: passwordSchema,
  })
  .partial();
export type EmployeeUpdateInput = z.input<typeof employeeUpdateSchema>;

/* ---------- Response shapes ---------- */

export interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  language: Language;
  theme: ThemeMode;
  businessId: string;
  role: Role;
  /** Del dueño: todos. De un empleado: los que el dueño le concedió (ya normalizados). */
  permissions: EmployeePermission[];
}

export interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  permissions: EmployeePermission[];
  active: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  /** "POST /service-records", "PATCH /employees/:id"… (ruta, nunca datos personales). */
  action: string;
  entityId: string | null;
  status: number;
  createdAt: string;
}

export interface Business {
  id: string;
  name: string;
  slug: string;
  type: BusinessType;
  whatsapp: string | null;
  address: string;
  city: string;
  country: string;
  currency: (typeof CURRENCIES)[number];
  timezone: string;
  hours: BusinessHours;
  logoUrl: string | null;
}

export interface Category {
  id: string;
  name: string;
  itemCount: number;
}

export interface ItemPhoto {
  id: string;
  url: string;
}

export interface Item {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  shortDescription: string;
  description: string;
  detail: string;
  price: number;
  published: boolean;
  referenceCode: string;
  internalUnitCost: number;
  stock: number;
  stockStatus: (typeof STOCK_STATUSES)[number];
  internalNotes: string;
  photos: ItemPhoto[];
  updatedAt: string;
}

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string;
  notes: string;
  createdAt: string;
}

export interface ServiceRecord {
  id: string;
  clientId: string;
  clientName: string;
  itemId: string | null;
  label: string;
  amount: number;
  note: string;
  loyaltyCounted: boolean;
  createdAt: string;
}

export interface LoyaltyProgram {
  enabled: boolean;
  goal: number;
  resetOnRedeem: boolean;
  rewardMessage: string;
  itemIds: string[];
}

export interface LoyaltyClientProgress {
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  count: number;
  goal: number;
  rewardAvailable: boolean;
}

export interface LoyaltyRedemption {
  id: string;
  clientId: string;
  clientName: string;
  goalAtRedemption: number;
  redeemedAt: string;
}

export interface NotificationSettings {
  enabled: boolean;
  loyaltyEnabled: boolean;
  billingEnabled: boolean;
}

export interface CashOpening {
  id: string;
  amount: number;
  note: string;
  openedAt: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: User;
  business: Business;
}

/** What the public catalog may expose. Never cost, internal price, stock, notes, users or clients. */
export interface PublicItem {
  id: string;
  name: string;
  category: string;
  shortDescription: string;
  description: string;
  detail: string;
  price: number;
  image: string | null;
  gallery: string[];
}

export interface PublicCatalog {
  business: { name: string; slug: string; whatsapp: string | null; currency: (typeof CURRENCIES)[number]; logoUrl: string | null };
  items: PublicItem[];
}

export interface ApiErrorBody {
  code: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}
