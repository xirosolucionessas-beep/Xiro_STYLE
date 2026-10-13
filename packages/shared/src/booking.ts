import { z } from 'zod';
import { emailSchema, phoneSchema } from './schemas';

/**
 * Contrato del módulo de Citas (agendamiento) y de la página pública de reservas. Fuente única de validación para la
 * API, la app y la página pública: los tipos se infieren de estos esquemas.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number) => trimmed(max).min(1, 'required');
const uuidString = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'not_found');

export const SLOT_INTERVALS = [15, 30, 60] as const;
export type SlotInterval = (typeof SLOT_INTERVALS)[number];

export const APPOINTMENT_STATUSES = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Estados que OCUPAN el calendario del profesional (una cita cancelada o con inasistencia libera el horario). */
export const OCCUPYING_STATUSES = ['pending', 'confirmed', 'in_progress', 'completed'] as const satisfies readonly AppointmentStatus[];

export const APPOINTMENT_SOURCES = ['app', 'web', 'walk_in'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

/** Estado de un horario en la cuadrícula: libre, ya reservado por otra persona, o no disponible por cualquier otra razón. */
export const SLOT_STATES = ['available', 'booked', 'unavailable'] as const;
export type SlotState = (typeof SLOT_STATES)[number];

const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'completed', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
};
export const canTransition = (from: AppointmentStatus, to: AppointmentStatus): boolean => TRANSITIONS[from].includes(to);

/* ---------- Slug de la página pública ---------- */

/** Rutas y nombres que un negocio no puede usar como dirección de su página. */
export const RESERVED_SLUGS = [
  'admin', 'api', 'app', 'assets', 'auth', 'book', 'booking', 'business', 'catalog', 'catalog-assets', 'cita', 'citas', 'client', 'clients', 'dashboard', 'health', 'help', 'inventory', 'login', 'logout', 'media',
  'more', 'notifications', 'privacy', 'profile', 'public', 'register', 'reportes', 'reports', 'reservar', 'reset', 'settings', 'static', 'subscription', 'support', 'terms', 'verify', 'welcome', 'xiro', 'www',
] as const;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'slug_invalid')
  .max(40, 'slug_invalid')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug_invalid')
  .refine((slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug), 'slug_reserved');
export const slugInputSchema = z.object({ slug: slugSchema });

/* ---------- Horarios ---------- */

export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_invalid');
export const isoDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'date_invalid');

export const scheduleBlockSchema = z
  .object({ weekday: z.number().int().min(0).max(6), from: timeOfDaySchema, to: timeOfDaySchema })
  .refine((block) => block.from < block.to, { message: 'hours_close_after_open', path: ['to'] });
export type ScheduleBlock = z.infer<typeof scheduleBlockSchema>;

/** Bloques de trabajo de una persona (o del negocio): varios por día, sin solaparse. */
export const scheduleBlocksSchema = z
  .array(scheduleBlockSchema)
  .max(35)
  .refine(
    (blocks) => {
      for (let day = 0; day < 7; day += 1) {
        const ofDay = blocks.filter((b) => b.weekday === day).sort((a, b) => a.from.localeCompare(b.from));
        for (let i = 1; i < ofDay.length; i += 1) if (ofDay[i]!.from < ofDay[i - 1]!.to) return false;
      }
      return true;
    },
    { message: 'hours_close_after_open' },
  );

export const employeeScheduleInputSchema = z.object({ blocks: scheduleBlocksSchema });

export const closureInputSchema = z.object({ date: isoDateSchema, reason: trimmed(80).default('') });

export const timeOffInputSchema = z
  .object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), reason: trimmed(80).default('') })
  .refine((v) => Date.parse(v.startsAt) < Date.parse(v.endsAt), { message: 'hours_close_after_open', path: ['endsAt'] });

/* ---------- Configuración de reservas ---------- */

export const customFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/, 'required'),
  label: required(60),
  type: z.enum(['text', 'date']).default('text'),
  required: z.boolean().default(false),
});
export type CustomField = z.infer<typeof customFieldSchema>;

export const bookingSettingsInputSchema = z.object({
  slotIntervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(30),
  minNoticeMinutes: z.number().int().min(0).max(10_080).default(60),
  maxDaysAhead: z.number().int().min(1).max(365).default(60),
  cancelUntilHours: z.number().int().min(0).max(720).default(2),
  maxModifications: z.number().int().min(0).max(10).default(2),
  autoConfirm: z.boolean().default(true),
  requireEmail: z.boolean().default(true),
  maxPendingPerPhone: z.number().int().min(1).max(20).default(3),
  /** null = usar el horario del negocio (`business.hours`); con valor, sustituye ese horario con varios bloques por día. */
  hoursBlocks: scheduleBlocksSchema.nullable().default(null),
  customFields: z.array(customFieldSchema).max(5).default([]),
  /** Un producto publicado que llega a 0 existencias: true = se oculta del catálogo público; false (por defecto) = sigue visible, marcado "Agotado". */
  hideOutOfStockInCatalog: z.boolean().default(false),
  /** Pedidos de solo productos desde la página pública (recoger y pagar en el local). Apagado por defecto. */
  productOrdersEnabled: z.boolean().default(false),
});
export type BookingSettingsInput = z.input<typeof bookingSettingsInputSchema>;
export type BookingSettings = z.infer<typeof bookingSettingsInputSchema>;

export const PUBLIC_SECTIONS = ['services', 'products', 'team', 'reviews', 'gallery', 'map'] as const;
export type PublicSection = (typeof PUBLIC_SECTIONS)[number];

const optionalUrl = trimmed(200).refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'required');

export const publicProfileInputSchema = z
  .object({
    displayName: trimmed(80),
    tagline: trimmed(120),
    description: trimmed(2000),
    conditions: trimmed(1500),
    privacyPolicy: trimmed(8000),
    phone: trimmed(30),
    instagram: optionalUrl,
    facebook: optionalUrl,
    tiktok: optionalUrl,
    website: optionalUrl,
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    /** Dirección del pin y lugar de Google. Solo tienen sentido con coordenadas: el servidor los borra si se quitan. */
    mapAddress: trimmed(300),
    placeId: z.string().trim().min(1).max(300).nullable(),
    sections: z.object(Object.fromEntries(PUBLIC_SECTIONS.map((s) => [s, z.boolean()])) as Record<PublicSection, z.ZodBoolean>).partial(),
    published: z.boolean(),
    /** Marca del negocio (Fase 3): color de acento #rrggbb (null = dorado por defecto). El contraste lo garantiza `brandAccent`. */
    accentColor: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, 'validation_error')
      .transform((value) => value.toLowerCase())
      .nullable(),
    /** Título de la página de reservas ('' = "Reserva tu experiencia"). */
    bookingTitle: trimmed(60),
    /** Hasta 3 avisos de confianza propios (p. ej. "Sin pago anticipado"). Vacío = ninguno. */
    trustBadges: z.array(trimmed(60).min(1, 'required')).max(3),
  })
  .partial();
export type PublicProfileInput = z.input<typeof publicProfileInputSchema>;

/* ---------- Servicios: variantes y paquetes ---------- */

export const variantInputSchema = z.object({
  name: required(60),
  description: trimmed(300).default(''),
  price: z.number().int().min(0).max(1_000_000_000),
  /** null = usa la duración del servicio. */
  durationMinutes: z.number().int().min(5).max(720).nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type VariantInput = z.input<typeof variantInputSchema>;

export const packageInputSchema = z.object({
  name: required(80),
  description: trimmed(500).default(''),
  price: z.number().int().min(0).max(1_000_000_000),
  /** null = suma de las duraciones de sus servicios. */
  durationMinutes: z.number().int().min(5).max(1_440).nullable().default(null),
  entries: z.array(z.object({ itemId: uuidString, variantId: uuidString.nullable().default(null) })).min(1).max(20),
  active: z.boolean().default(true),
  visibleOnWeb: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type PackageInput = z.input<typeof packageInputSchema>;

/** Revisión única de la clasificación servicio/producto de los artículos ya existentes. */
export const classificationConfirmSchema = z.object({
  entries: z
    .array(z.object({ itemId: uuidString, kind: z.enum(['service', 'product']), durationMinutes: z.number().int().min(5).max(720).optional() }))
    .min(1)
    .max(500),
});

/* ---------- Profesionales ---------- */

export const professionalInputSchema = z
  .object({
    bookable: z.boolean(),
    publicName: trimmed(60),
    bio: trimmed(400),
    /** Especialidad visible en la página pública (p. ej. "Colorista"). */
    specialty: trimmed(60),
    visible: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();
export type ProfessionalInput = z.input<typeof professionalInputSchema>;

export const professionalServicesInputSchema = z.object({
  services: z
    .array(z.object({ itemId: uuidString, priceOverride: z.number().int().min(0).max(1_000_000_000).nullable().default(null), durationOverride: z.number().int().min(5).max(720).nullable().default(null) }))
    .max(200),
});

/* ---------- Citas ---------- */

/** Lo que se reserva: servicios (con estilo opcional), paquetes y productos apartados. */
export const bookingSelectionSchema = z
  .object({
    services: z.array(z.object({ itemId: uuidString, variantId: uuidString.nullable().default(null) })).max(10).default([]),
    packages: z.array(uuidString).max(5).default([]),
    products: z.array(z.object({ itemId: uuidString, quantity: z.number().int().min(1).max(20).default(1) })).max(10).default([]),
  })
  .refine((s) => s.services.length + s.packages.length > 0, { message: 'required', path: ['services'] });
export type BookingSelection = z.infer<typeof bookingSelectionSchema>;

export const staffAppointmentInputSchema = z
  .object({
    clientId: uuidString.optional(),
    newClient: z.object({ name: required(80), phone: phoneSchema.optional(), email: emailSchema.optional() }).optional(),
    /** 'any' = "Primero disponible": el sistema elige a quién le toca. */
    professionalId: z.union([z.literal('any'), uuidString]),
    startsAt: z.iso.datetime(),
    selection: bookingSelectionSchema,
    source: z.enum(['app', 'walk_in']).default('app'),
    customerNotes: trimmed(500).default(''),
    internalNotes: trimmed(1000).default(''),
  })
  .refine((v) => Boolean(v.clientId) !== Boolean(v.newClient), { message: 'required', path: ['clientId'] });
export type StaffAppointmentInput = z.input<typeof staffAppointmentInputSchema>;

export const appointmentPatchSchema = z
  .object({
    startsAt: z.iso.datetime(),
    professionalId: uuidString,
    internalNotes: trimmed(1000),
    customerNotes: trimmed(500),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'required');

export const appointmentTransitionSchema = z.object({ status: z.enum(APPOINTMENT_STATUSES), reason: trimmed(200).default('') });

export const appointmentsQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  professionalId: uuidString.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

/* ---------- Página pública ---------- */

const customerSchema = z.object({
  firstName: required(50),
  lastName: required(50),
  // Siempre opcional (ver sección 3): una cadena vacía cuenta como "no dio correo", no como un formato inválido.
  email: emailSchema.or(z.literal('').transform(() => undefined)).optional(),
  phone: phoneSchema,
  notes: trimmed(500).default(''),
  custom: z.record(z.string().max(40), z.string().trim().max(200)).default({}),
});
/** Los datos de quien reserva o pide en la página pública (mismas reglas en citas y pedidos de productos). */
export const publicCustomerSchema = customerSchema;

export const publicBookingInputSchema = z.object({
  selection: bookingSelectionSchema,
  /** UUID de un profesional, o 'any' ("Primero disponible"). */
  professionalId: z.union([z.literal('any'), uuidString]),
  startsAt: z.iso.datetime(),
  customer: customerSchema,
  acceptTerms: z.literal(true, { error: 'terms_required' }),
  remindersOptIn: z.boolean().default(false),
  /** Campo trampa: las personas no lo ven ni lo llenan; un bot sí. */
  website: z.string().max(200).default(''),
  captchaToken: z.string().max(4096).optional(),
  /**
   * Un UUID por intento de confirmar (lo genera la página al abrir el resumen). Repetir la MISMA petición —doble clic, reintento
   * por mala señal— devuelve la cita ya creada en vez de fallar o duplicarla. Opcional: sin él, cada envío cuenta como nuevo.
   */
  idempotencyKey: uuidString.optional(),
});
export type PublicBookingInput = z.input<typeof publicBookingInputSchema>;

export const publicRescheduleInputSchema = z.object({ startsAt: z.iso.datetime(), professionalId: z.union([z.literal('any'), uuidString]).optional() });
export const publicCancelInputSchema = z.object({ reason: trimmed(200).default('') });

/** Parámetros de disponibilidad: lo elegido va en la consulta como `services=id:variante,id`, `packages=id,id`. */
export const availabilityQuerySchema = z.object({
  date: isoDateSchema,
  professionalId: z.union([z.literal('any'), uuidString]).default('any'),
  services: z.string().max(800).default(''),
  packages: z.string().max(400).default(''),
  /** Solo agenda del personal: ignora esta cita al calcular horarios (para moverla sin que su propio horario aparezca ocupado). La página pública NO lo usa. */
  excludeAppointmentId: uuidString.optional(),
});

export const daysQuerySchema = z.object({
  from: isoDateSchema,
  days: z.coerce.number().int().min(1).max(62).default(14),
  professionalId: z.union([z.literal('any'), uuidString]).default('any'),
  services: z.string().max(800).default(''),
  packages: z.string().max(400).default(''),
  excludeAppointmentId: uuidString.optional(),
});

/* ---------- Respuestas ---------- */

export interface AvailabilitySlot {
  /** Hora local del negocio, "HH:MM". */
  time: string;
  /** Instante de inicio en UTC (ISO). */
  startsAt: string;
  state: SlotState;
}

export interface AvailabilityResponse {
  date: string;
  timezone: string;
  intervalMinutes: number;
  /** Duración total que se reserva (servicios + tiempo de limpieza). */
  totalMinutes: number;
  slots: AvailabilitySlot[];
}

export interface DaySummary {
  date: string;
  /** Hay al menos un horario libre ese día. */
  hasAvailability: boolean;
  /** El negocio (o el profesional elegido) trabaja ese día. */
  open: boolean;
}

export interface SlotTakenBody {
  code: 'slot_taken';
  message: string;
  /** Horarios libres más cercanos, para ofrecer alternativas. */
  alternatives: AvailabilitySlot[];
}

/* ---------- DTOs ---------- */

export interface AppointmentItemDto {
  id: string;
  kind: 'service' | 'package' | 'product';
  /** Referencias al catálogo (para volver a calcular horarios al mover la cita); null si el artículo ya no existe. */
  itemId: string | null;
  variantId: string | null;
  packageId: string | null;
  name: string;
  price: number;
  durationMinutes: number;
  quantity: number;
}

/** Cita tal como la ve el personal del negocio (incluye notas internas y datos del cliente). */
export interface AppointmentDto {
  id: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  totalPrice: number;
  customerNotes: string;
  internalNotes: string;
  modificationCount: number;
  createdAt: string;
  professional: { id: string; name: string };
  client: { id: string; name: string; phone: string | null; email: string | null };
  items: AppointmentItemDto[];
}

export interface ProfessionalDto {
  id: string;
  name: string;
  publicName: string;
  bio: string;
  specialty: string;
  photoUrl: string | null;
  bookable: boolean;
  visible: boolean;
  sortOrder: number;
  isOwner: boolean;
  /** Bloques de trabajo propios; vacío = sigue el horario del negocio. */
  schedule: ScheduleBlock[];
  /** Servicios que hace (vacío = todos los reservables). */
  serviceIds: string[];
  /** Ajustes propios de precio o duración por servicio (null = usa los del servicio). */
  serviceOverrides: Array<{ itemId: string; priceOverride: number | null; durationOverride: number | null }>;
}

export interface ReviewDto {
  id: string;
  rating: number;
  comment: string;
  authorName: string;
  status: 'pending' | 'approved' | 'hidden';
  createdAt: string;
}

/** Lo que el cliente ve de SU cita al abrir su enlace de gestión: nunca datos de otras personas. */
export interface PublicAppointmentDto {
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  totalPrice: number;
  professionalName: string;
  items: AppointmentItemDto[];
  business: {
    name: string;
    slug: string;
    address: string;
    city: string;
    phone: string | null;
    whatsapp: string | null;
    timezone: string;
    currency: string;
    /** Pin del local (para "Cómo llegar"); null si el negocio no publicó ubicación. */
    location: { latitude: number; longitude: number; placeId: string | null; address: string } | null;
  };
  canCancel: boolean;
  canReschedule: boolean;
  modificationsLeft: number;
  /** Último instante en que el negocio permite cancelar o mover la cita. */
  changeableUntil: string;
  /** La cita ya se completó y todavía no tiene reseña: se puede dejar una con el mismo enlace. */
  canReview: boolean;
}

/**
 * Lo mismo que `PublicAppointmentDto`, con el `id` real de la cita — solo en "Mis citas" (sesión de cuenta de cliente
 * ya autenticada y acotada a SUS propias citas), nunca en el flujo anónimo por enlace/token (`PublicAppointmentDto`
 * lo omite a propósito ahí: el token es la única llave, no hace falta ni conviene exponer el id interno).
 */
export interface ClientAppointmentDto extends PublicAppointmentDto {
  id: string;
}

/** Lo que el cliente envía para reseñar SU cita ya completada, con el mismo enlace de gestión. */
export const publicReviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: trimmed(500).default(''),
});
export type PublicReviewInput = z.input<typeof publicReviewInputSchema>;

export interface PublicBookingResult {
  appointment: PublicAppointmentDto;
  /** Token de gestión: se entrega UNA sola vez (en la base solo queda su hash). */
  token: string;
}

/* ---------- Contenido de la página pública (lista blanca: solo lo que se puede mostrar) ---------- */

export interface PublicVariantDto {
  id: string;
  name: string;
  description: string;
  price: number;
  durationMinutes: number;
}

export interface PublicServiceDto {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  durationMinutes: number;
  /** La primera (o única) foto, para la miniatura de la lista — igual a `images[0]`. */
  image: string | null;
  /** Todas las fotos del servicio, en el orden que eligió el negocio — para la galería del detalle. */
  images: string[];
  variants: PublicVariantDto[];
}

export interface PublicPackageDto {
  id: string;
  name: string;
  description: string;
  price: number;
  durationMinutes: number;
  /** Nombres de los servicios que incluye. */
  services: string[];
  image: string | null;
}

/** Producto que se puede apartar: nunca se expone el stock exacto ni el costo, solo si hay. */
export interface PublicProductDto {
  id: string;
  name: string;
  description: string;
  price: number;
  /** La primera (o única) foto, para la miniatura de la lista — igual a `images[0]`. */
  image: string | null;
  /** Todas las fotos del producto, en el orden que eligió el negocio — para la galería del detalle. */
  images: string[];
  inStock: boolean;
}

export interface PublicTeamMemberDto {
  id: string;
  name: string;
  bio: string;
  /** Especialidad ('' = no se muestra). */
  specialty: string;
  /** Calificación de las reseñas APROBADAS de las citas que atendió; null si el negocio oculta sus reseñas. */
  rating: { average: number | null; count: number } | null;
  photoUrl: string | null;
  /** Servicios que hace; vacío = todos los reservables. */
  serviceIds: string[];
}

export interface PublicReviewDto {
  rating: number;
  comment: string;
  authorName: string;
  createdAt: string;
}

export interface PublicBookingCatalog {
  services: PublicServiceDto[];
  packages: PublicPackageDto[];
  products: PublicProductDto[];
}

export interface PublicBookingProfile {
  /** Dirección actual de la página (si se entró por una anterior, es la vigente). */
  slug: string;
  name: string;
  tagline: string;
  description: string;
  conditions: string;
  privacyPolicy: string;
  address: string;
  city: string;
  country: string;
  phone: string | null;
  whatsapp: string | null;
  instagram: string;
  facebook: string;
  tiktok: string;
  website: string;
  latitude: number | null;
  longitude: number | null;
  /** Dirección del pin en el mapa (puede diferir de `address`, que es la del negocio). Vacía si no hay ubicación. */
  mapAddress: string;
  placeId: string | null;
  /** Ruta (misma web) de la imagen del mapa, ya con el pin dorado; null si no hay ubicación o el servidor no tiene clave de Google. */
  mapImageUrl: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  gallery: string[];
  timezone: string;
  currency: string;
  sections: Record<PublicSection, boolean>;
  hours: Array<{ weekday: number; from: string; to: string }>;
  openNow: boolean;
  /** Cuándo cambia el estado: si está abierto, la hora de cierre de hoy; si está cerrado, la próxima apertura (null si no hay ninguna en 14 días). */
  openStatus: { open: boolean; changesAt: string | null };
  /** ¿Se puede reservar en línea AHORA? Hay al menos un servicio reservable y alguien que atienda. Si no, la página no ofrece "Reservar". */
  acceptsBookings: boolean;
  /** ¿Se pueden pedir productos sin cita (recoger y pagar en el local)? El negocio lo activó y tiene al menos un producto disponible. */
  acceptsProductOrders: boolean;
  rating: { average: number | null; count: number };
  rules: { slotIntervalMinutes: number; maxDaysAhead: number; cancelUntilHours: number; maxModifications: number; requireEmail: boolean; customFields: CustomField[] };
  /** Clave pública de Cloudflare Turnstile para dibujar el widget; null = sin verificación anti-bots configurada (pendiente de credenciales). */
  captchaSiteKey: string | null;
  /** Marca del negocio (Fase 3): acento (#rrggbb, null = dorado por defecto), título propio ('' = por defecto) y avisos de confianza. */
  accentColor: string | null;
  bookingTitle: string;
  trustBadges: string[];
}

/** Los cuatro requisitos para reservar en línea; `ready` = todos cumplidos. Es la única fuente de esta regla (servidor). */
export interface BookingReadiness {
  published: boolean;
  /** Servicios que se pueden reservar en la web (tipo servicio, reservables y publicados). */
  bookableServices: number;
  /** Personas que atienden citas (activas y marcadas como profesionales; el dueño cuenta si activó "Yo también atiendo citas"). */
  bookableProfessionals: number;
  /** Días de la semana con horario de atención. */
  openDays: number;
  ready: boolean;
}

/** Configuración de la página vista desde la app (dueño / quien gestiona la página). */
export interface BookingAdminSettings {
  settings: BookingSettings;
  slug: string;
  timezone: string;
  /** Qué le falta al negocio para que un cliente pueda reservar en línea (alimenta la lista de pasos de "Mi página web"). */
  readiness: BookingReadiness;
  profile: {
    published: boolean;
    displayName: string;
    tagline: string;
    description: string;
    conditions: string;
    privacyPolicy: string;
    phone: string;
    instagram: string;
    facebook: string;
    tiktok: string;
    website: string;
    latitude: number | null;
    longitude: number | null;
    mapAddress: string;
    placeId: string | null;
    coverUrl: string | null;
    gallery: Array<{ file: string; url: string }>;
    sections: Record<PublicSection, boolean>;
    accentColor: string | null;
    bookingTitle: string;
    trustBadges: string[];
  };
}

export interface ClassificationEntry {
  id: string;
  name: string;
  categoryName: string;
  price: number;
  stock: number;
  /** Clasificación propuesta automáticamente (con existencias = producto). */
  suggestedKind: 'service' | 'product';
  kind: 'service' | 'product';
  durationMinutes: number;
}

export interface VariantDto {
  id: string;
  itemId: string;
  name: string;
  description: string;
  price: number;
  durationMinutes: number | null;
  active: boolean;
  sortOrder: number;
}

export interface PackageDto {
  id: string;
  name: string;
  description: string;
  price: number;
  durationMinutes: number | null;
  active: boolean;
  visibleOnWeb: boolean;
  sortOrder: number;
  entries: Array<{ itemId: string; variantId: string | null }>;
}

export interface ClosureDto {
  id: string;
  date: string;
  reason: string;
}

export interface TimeOffDto {
  id: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}
