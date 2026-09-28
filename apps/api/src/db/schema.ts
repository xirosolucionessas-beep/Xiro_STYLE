import { sql } from 'drizzle-orm';
import { boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { BookingSettings, BusinessHours, CustomField, PublicSection } from '@xiro/shared';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/* Los precios y costos son enteros en la unidad principal de la moneda (pesos, dólares…), con tope 1 000 000 000 (int4),
   por eso `integer` + CHECK es exacto: sin coma flotante ni redondeos. */

export const businesses = pgTable(
  'businesses',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    type: text('type').notNull(),
    whatsapp: text('whatsapp'),
    address: text('address').notNull().default(''),
    city: text('city').notNull().default(''),
    country: text('country').notNull().default('Colombia'),
    currency: text('currency').notNull().default('COP'),
    timezone: text('timezone').notNull().default('America/Bogota'),
    hours: jsonb('hours').$type<BusinessHours>().notNull(),
    logoFile: text('logo_file'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('businesses_slug_uq').on(t.slug),
    check('businesses_type_ck', sql`${t.type} in ('barbershop','beauty_salon','spa','nails','other')`),
    check('businesses_currency_ck', sql`${t.currency} in ('COP','USD','MXN','EUR')`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    /** Los access tokens emitidos antes de este instante dejan de valer (cambio de contraseña). */
    passwordChangedAt: ts('password_changed_at').notNull().defaultNow(),
    language: text('language').notNull().default('es'),
    theme: text('theme').notNull().default('dark'),
    role: text('role').notNull().default('owner'),
    /** Solo aplica a empleados (el dueño lo puede todo). Lista ya normalizada de EMPLOYEE_PERMISSIONS. */
    permissions: jsonb('permissions').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Un empleado desactivado no puede iniciar sesión ni usar sesiones abiertas; su historial de auditoría se conserva. */
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check('users_role_ck', sql`${t.role} in ('owner','employee')`),
    // Necesario para las FK compuestas de las tablas de citas (una cita solo puede apuntar a personas del mismo negocio).
    unique('users_id_business_uq').on(t.id, t.businessId),
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_phone_uq').on(t.phone),
    index('users_business_idx').on(t.businessId),
    check('users_contact_ck', sql`${t.email} is not null or ${t.phone} is not null`),
    check('users_language_ck', sql`${t.language} in ('es','en')`),
    check('users_theme_ck', sql`${t.theme} in ('dark','light')`),
  ],
);

/**
 * Refresh tokens rotativos. Un token usado NO se borra: queda con `used_at` para detectar reutilización
 * (señal de robo) y revocar toda su familia.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_user_idx').on(t.userId), index('refresh_family_idx').on(t.familyId), index('refresh_expires_idx').on(t.expiresAt)],
);

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    used: boolean('used').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('otp_user_idx').on(t.userId), index('otp_expires_idx').on(t.expiresAt)],
);

export const resetTokens = pgTable(
  'reset_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('reset_user_idx').on(t.userId), index('reset_expires_idx').on(t.expiresAt)],
);

/**
 * Cambio de celular pendiente de verificación: el número nuevo se guarda aquí (no en `users`) hasta que se confirma
 * con el código enviado a ESE número. Evita que una sesión robada desvíe la recuperación de la cuenta a otro teléfono
 * sin demostrar que quien pide el cambio realmente controla el número nuevo.
 */
export const phoneChanges = pgTable(
  'phone_changes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    newPhone: text('new_phone').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    used: boolean('used').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('phone_changes_user_idx').on(t.userId), index('phone_changes_expires_idx').on(t.expiresAt)],
);

export const categories = pgTable(
  'categories',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
  },
  (t) => [
    // Sin distinguir mayúsculas dentro de un negocio.
    uniqueIndex('categories_business_name_uq').on(t.businessId, sql`lower(${t.name})`),
    // Necesario para la FK compuesta de items (integridad entre negocios). Es una restricción de la tabla (no un índice
    // aparte) para que se cree ANTES que la FK que la referencia.
    unique('categories_id_business_uq').on(t.id, t.businessId),
  ],
);

export const items = pgTable(
  'items',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull(),
    name: text('name').notNull(),
    shortDescription: text('short_description').notNull().default(''),
    description: text('description').notNull().default(''),
    detail: text('detail').notNull().default(''),
    price: integer('price').notNull(),
    published: boolean('published').notNull().default(true),
    referenceCode: text('reference_code').notNull().default(''),
    internalUnitCost: integer('internal_unit_cost').notNull().default(0),
    stock: integer('stock').notNull().default(0),
    stockStatus: text('stock_status').notNull(),
    internalNotes: text('internal_notes').notNull().default(''),
    /** 'service' se reserva en una cita (tiene duración); 'product' se vende/aparta (tiene stock). */
    kind: text('kind').notNull().default('service'),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    cleanupMinutes: integer('cleanup_minutes').notNull().default(0),
    bookable: boolean('bookable').notNull().default(true),
    /** El dueño ya confirmó la clasificación servicio/producto en la pantalla de revisión. */
    kindConfirmed: boolean('kind_confirmed').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('items_id_business_uq').on(t.id, t.businessId),
    check('items_kind_ck', sql`${t.kind} in ('service','product')`),
    check('items_duration_ck', sql`${t.durationMinutes} between 5 and 720`),
    check('items_cleanup_ck', sql`${t.cleanupMinutes} between 0 and 120`),
    // La categoría debe existir Y pertenecer al mismo negocio (lo garantiza la base de datos, no solo el código).
    foreignKey({ columns: [t.categoryId, t.businessId], foreignColumns: [categories.id, categories.businessId], name: 'items_category_business_fk' }),
    index('items_business_updated_idx').on(t.businessId, t.updatedAt.desc()),
    index('items_category_idx').on(t.categoryId),
    // Catálogo público: solo publicados, del más reciente al más antiguo.
    index('items_public_idx').on(t.businessId, t.updatedAt.desc()).where(sql`${t.published}`),
    check('items_price_ck', sql`${t.price} >= 0 and ${t.price} <= 1000000000`),
    check('items_cost_ck', sql`${t.internalUnitCost} >= 0 and ${t.internalUnitCost} <= 1000000000`),
    check('items_stock_ck', sql`${t.stock} >= 0 and ${t.stock} <= 1000000`),
    check('items_status_ck', sql`${t.stockStatus} in ('available','reorder','out_of_stock')`),
  ],
);

export const itemPhotos = pgTable(
  'item_photos',
  {
    id: id(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('photos_item_position_idx').on(t.itemId, t.position)],
);

export const clients = pgTable(
  'clients',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address').notNull().default(''),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('clients_business_name_idx').on(t.businessId, sql`lower(${t.name})`), unique('clients_id_business_uq').on(t.id, t.businessId)],
);

/**
 * Suscripción de pago del negocio (planes Mensual/Anual, prueba de 7 días). Una fila por negocio; no existe hasta que
 * el negocio elige un plan por primera vez (antes de eso, `GET /api/subscription` responde "sin suscripción").
 * RevenueCat es la fuente de verdad para iOS/Android (unifica StoreKit 2 y Play Billing); Stripe/PayPal para Web.
 * `status` distingue "vencido con período de gracia" (`past_due`, todavía con acceso) de "vencido sin acceso" (`expired`).
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    plan: text('plan'),
    status: text('status').notNull().default('trial'),
    platform: text('platform').notNull(),
    paymentMethod: text('payment_method'),
    trialStartedAt: ts('trial_started_at'),
    trialEndsAt: ts('trial_ends_at'),
    /** Quién reclamó la prueba gratuita (auditoría anti-abuso: un mismo usuario no puede reclamarla dos veces). */
    trialClaimedByUserId: uuid('trial_claimed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    currentPeriodStart: ts('current_period_start'),
    currentPeriodEnd: ts('current_period_end'),
    nextBillingAt: ts('next_billing_at'),
    /** true = el usuario canceló pero conserva acceso hasta `current_period_end` (no se revoca de inmediato). */
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    /** Fin del período de gracia tras un fallo de cobro; con acceso hasta esta fecha aunque `status` ya sea `past_due`. */
    gracePeriodEndsAt: ts('grace_period_ends_at'),
    /** Id del cliente en el proveedor (RevenueCat app_user_id, Stripe customer id, PayPal payer id). */
    externalCustomerId: text('external_customer_id'),
    /** Id de la transacción/suscripción más reciente en el proveedor. */
    externalSubscriptionId: text('external_subscription_id'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('subscriptions_business_uq').on(t.businessId),
    index('subscriptions_status_idx').on(t.status),
    // El job diario de recordatorios recorre por próximo cobro / fin de gracia sin escanear toda la tabla.
    index('subscriptions_next_billing_idx').on(t.nextBillingAt),
    check('subscriptions_plan_ck', sql`${t.plan} is null or ${t.plan} in ('monthly','yearly')`),
    check('subscriptions_status_ck', sql`${t.status} in ('trial','active','past_due','expired','canceled')`),
    check('subscriptions_platform_ck', sql`${t.platform} in ('ios','android','web')`),
    check('subscriptions_payment_method_ck', sql`${t.paymentMethod} is null or ${t.paymentMethod} in ('card','paypal','bank_transfer')`),
  ],
);

/**
 * Auditoría de cambios de estado (soporte al cliente, disputas de pago). Nunca se borra ni se edita.
 * `externalEventId` + `source` hacen idempotente el procesamiento de webhooks (los proveedores reenvían eventos).
 */
export const subscriptionEvents = pgTable(
  'subscription_events',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    source: text('source').notNull(),
    externalEventId: text('external_event_id'),
    /** Cuerpo crudo del webhook (o de la acción administrativa), para disputas de pago. */
    payload: jsonb('payload'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sub_events_business_idx').on(t.businessId, t.createdAt.desc()),
    uniqueIndex('sub_events_external_uq').on(t.source, t.externalEventId),
    check('sub_events_source_ck', sql`${t.source} in ('revenuecat','stripe','paypal','admin','system')`),
  ],
);

export const cashOpenings = pgTable(
  'cash_openings',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    /** Día local del negocio (YYYY-MM-DD). */
    day: date('day', { mode: 'string' }).notNull(),
    amount: integer('amount').notNull(),
    note: text('note').notNull().default(''),
    openedAt: ts('opened_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cash_business_day_uq').on(t.businessId, t.day), check('cash_amount_ck', sql`${t.amount} >= 0 and ${t.amount} <= 1000000000`)],
);

/**
 * Registro mínimo de "servicio realizado y cobrado" a un cliente (todavía no existe un módulo de citas/ventas
 * completo). `label`/`amount` quedan congelados al momento del registro: sobreviven aunque el item cambie de precio
 * o se borre después (por eso `item_id` permite null — se conserva la fila, se pierde solo el enlace). Es el único
 * disparador del contador de fidelización: cada fila nueva de un item elegible suma exactamente un sello, una vez.
 */
export const serviceRecords = pgTable(
  'service_records',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    amount: integer('amount').notNull(),
    note: text('note').notNull().default(''),
    loyaltyCounted: boolean('loyalty_counted').notNull().default(false),
    /** Cita de la que salió este cobro (al completarla). Sin cita = registro manual. */
    appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('service_records_client_idx').on(t.businessId, t.clientId, t.createdAt.desc()),
    index('service_records_business_idx').on(t.businessId, t.createdAt.desc()),
    index('service_records_appointment_idx').on(t.appointmentId),
    check('service_records_amount_ck', sql`${t.amount} >= 0 and ${t.amount} <= 1000000000`),
  ],
);

/** Configuración del programa de fidelización: una fila por negocio, creada la primera vez que se guarda desde Ajustes. */
export const loyaltyPrograms = pgTable(
  'loyalty_programs',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    goal: integer('goal').notNull().default(10),
    /** true: al canjear, el contador vuelve a 0. false: se resta solo la meta (lo que sobraba sigue contando). */
    resetOnRedeem: boolean('reset_on_redeem').notNull().default(true),
    rewardMessage: text('reward_message').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('loyalty_programs_business_uq').on(t.businessId), check('loyalty_programs_goal_ck', sql`${t.goal} >= 1 and ${t.goal} <= 1000`)],
);

/** Qué items del catálogo cuentan para la meta (checklist de "qué servicios cuentan"). */
export const loyaltyProgramItems = pgTable(
  'loyalty_program_items',
  {
    programId: uuid('program_id')
      .notNull()
      .references(() => loyaltyPrograms.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.programId, t.itemId] })],
);

/** Contador vigente por cliente. Uno por (negocio, cliente); se crea con el primer servicio elegible. */
export const loyaltyProgress = pgTable(
  'loyalty_progress',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    count: integer('count').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('loyalty_progress_client_uq').on(t.businessId, t.clientId), check('loyalty_progress_count_ck', sql`${t.count} >= 0`)],
);

/** Historial de canjes (append-only): qué meta tenía el programa en ese momento y quién lo canjeó. */
export const loyaltyRedemptions = pgTable(
  'loyalty_redemptions',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    goalAtRedemption: integer('goal_at_redemption').notNull(),
    redeemedBy: uuid('redeemed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    redeemedAt: createdAt(),
  },
  (t) => [index('loyalty_redemptions_client_idx').on(t.businessId, t.clientId, t.redeemedAt.desc())],
);

/** Preferencias de notificaciones: una fila por negocio (igual que loyalty_programs), creada al primer guardado. */
export const notificationSettings = pgTable('notification_settings', {
  businessId: uuid('business_id')
    .primaryKey()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  loyaltyEnabled: boolean('loyalty_enabled').notNull().default(true),
  billingEnabled: boolean('billing_enabled').notNull().default(true),
  appointmentsEnabled: boolean('appointments_enabled').notNull().default(true),
  reviewsEnabled: boolean('reviews_enabled').notNull().default(true),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/**
 * Un token de push por dispositivo. 'expo': token de Expo Push (Android/iOS, se manda a exp.host). 'web': suscripción
 * Web Push del navegador — el "token" es el endpoint; p256dh/auth solo existen para ese caso (cifran el payload).
 */
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    token: text('token').notNull(),
    p256dh: text('p256dh'),
    auth: text('auth'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('push_tokens_user_token_uq').on(t.userId, t.token),
    index('push_tokens_business_idx').on(t.businessId),
    check('push_tokens_platform_ck', sql`${t.platform} in ('expo','web')`),
  ],
);

/**
 * Bitácora básica de acciones de empleados (y de la gestión de empleados por el dueño): quién, qué ruta, sobre qué
 * registro y con qué resultado. Solo se guardan rutas e ids — nunca el cuerpo de la petición ni datos personales.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    entityId: text('entity_id'),
    status: integer('status').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_business_idx').on(t.businessId, t.createdAt.desc()), index('audit_logs_user_idx').on(t.userId, t.createdAt.desc())],
);


/* =====================================================================================================================
 * Citas (agendamiento) y página pública de reservas.
 * TODAS las tablas de esta sección llevan business_id y tienen Row Level Security (ver la migración): además del filtro
 * que pone el código, PostgreSQL rechaza leer o escribir filas de otro negocio. Las referencias a personas, artículos y
 * clientes son FK compuestas (id, business_id): una cita jamás puede apuntar a datos de otro negocio.
 * ===================================================================================================================== */

const businessRef = () =>
  uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' });

/** Perfil público de la página de reservas (una fila por negocio). El slug vive en `businesses.slug`. */
export const businessPublicProfiles = pgTable(
  'business_public_profiles',
  {
    businessId: uuid('business_id')
      .primaryKey()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    published: boolean('published').notNull().default(false),
    displayName: text('display_name').notNull().default(''),
    tagline: text('tagline').notNull().default(''),
    description: text('description').notNull().default(''),
    conditions: text('conditions').notNull().default(''),
    privacyPolicy: text('privacy_policy').notNull().default(''),
    phone: text('phone').notNull().default(''),
    instagram: text('instagram').notNull().default(''),
    facebook: text('facebook').notNull().default(''),
    tiktok: text('tiktok').notNull().default(''),
    website: text('website').notNull().default(''),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** Dirección formateada del pin (la que devolvió el buscador o la geocodificación inversa) y el lugar de Google, si vino de uno. */
    mapAddress: text('map_address').notNull().default(''),
    placeId: text('place_id'),
    coverFile: text('cover_file'),
    galleryFiles: jsonb('gallery_files').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    sections: jsonb('sections').$type<Partial<Record<PublicSection, boolean>>>().notNull().default(sql`'{}'::jsonb`),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [check('bpp_coords_ck', sql`(${t.latitude} is null) = (${t.longitude} is null)`)],
);

/** Reglas de agenda y reservas del negocio (una fila por negocio; sin fila se usan los valores por defecto). */
export const businessSettings = pgTable(
  'business_settings',
  {
    businessId: uuid('business_id')
      .primaryKey()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    slotIntervalMinutes: integer('slot_interval_minutes').notNull().default(30),
    minNoticeMinutes: integer('min_notice_minutes').notNull().default(60),
    maxDaysAhead: integer('max_days_ahead').notNull().default(60),
    cancelUntilHours: integer('cancel_until_hours').notNull().default(2),
    maxModifications: integer('max_modifications').notNull().default(2),
    autoConfirm: boolean('auto_confirm').notNull().default(true),
    requireEmail: boolean('require_email').notNull().default(true),
    maxPendingPerPhone: integer('max_pending_per_phone').notNull().default(3),
    /** null = usar `businesses.hours`. Con valor, sustituye ese horario con varios bloques por día. */
    hoursBlocks: jsonb('hours_blocks').$type<BookingSettings['hoursBlocks']>(),
    customFields: jsonb('custom_fields').$type<CustomField[]>().notNull().default(sql`'[]'::jsonb`),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('bs_interval_ck', sql`${t.slotIntervalMinutes} in (15,30,60)`),
    check('bs_notice_ck', sql`${t.minNoticeMinutes} between 0 and 10080`),
    check('bs_ahead_ck', sql`${t.maxDaysAhead} between 1 and 365`),
  ],
);

/** Días cerrados (festivos, vacaciones del negocio). */
export const businessClosures = pgTable(
  'business_closures',
  {
    id: id(),
    businessId: businessRef(),
    date: date('date', { mode: 'string' }).notNull(),
    reason: text('reason').notNull().default(''),
  },
  (t) => [uniqueIndex('business_closures_day_uq').on(t.businessId, t.date)],
);

/** Direcciones anteriores de la página: redirigen a la actual (no hay RLS: se consulta por slug antes de saber el negocio). */
export const businessSlugHistory = pgTable(
  'business_slug_history',
  {
    slug: text('slug').primaryKey(),
    businessId: businessRef(),
    createdAt: createdAt(),
  },
  (t) => [index('business_slug_history_business_idx').on(t.businessId)],
);

/** Perfil de atención de una persona del equipo (dueño o empleado): si se puede reservar con ella y cómo se ve en la web. */
export const employeeProfiles = pgTable(
  'employee_profiles',
  {
    userId: uuid('user_id').primaryKey(),
    businessId: businessRef(),
    bookable: boolean('bookable').notNull().default(false),
    publicName: text('public_name').notNull().default(''),
    bio: text('bio').notNull().default(''),
    photoFile: text('photo_file'),
    visible: boolean('visible').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.userId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'employee_profiles_user_business_fk' }).onDelete('cascade'),
    unique('employee_profiles_user_business_uq').on(t.userId, t.businessId),
    index('employee_profiles_business_idx').on(t.businessId, t.sortOrder),
  ],
);

/** Horario de trabajo de una persona: varios bloques por día ("HH:MM"). Sin filas = sigue el horario del negocio. */
export const employeeSchedules = pgTable(
  'employee_schedules',
  {
    id: id(),
    businessId: businessRef(),
    userId: uuid('user_id').notNull(),
    weekday: integer('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.userId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'employee_schedules_user_business_fk' }).onDelete('cascade'),
    index('employee_schedules_user_idx').on(t.userId, t.weekday),
    check('employee_schedules_day_ck', sql`${t.weekday} between 0 and 6`),
    check('employee_schedules_order_ck', sql`${t.startTime} < ${t.endTime}`),
  ],
);

/** Ausencias y vacaciones. */
export const employeeTimeOff = pgTable(
  'employee_time_off',
  {
    id: id(),
    businessId: businessRef(),
    userId: uuid('user_id').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    reason: text('reason').notNull().default(''),
  },
  (t) => [
    foreignKey({ columns: [t.userId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'employee_time_off_user_business_fk' }).onDelete('cascade'),
    index('employee_time_off_user_idx').on(t.userId, t.startsAt),
    check('employee_time_off_order_ck', sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

/** Qué servicios hace cada persona (con precio o duración propios opcionales). */
export const employeeServices = pgTable(
  'employee_services',
  {
    businessId: businessRef(),
    userId: uuid('user_id').notNull(),
    itemId: uuid('item_id').notNull(),
    priceOverride: integer('price_override'),
    durationOverride: integer('duration_override'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemId] }),
    foreignKey({ columns: [t.userId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'employee_services_user_business_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.itemId, t.businessId], foreignColumns: [items.id, items.businessId], name: 'employee_services_item_business_fk' }).onDelete('cascade'),
    index('employee_services_item_idx').on(t.itemId),
    check('employee_services_price_ck', sql`${t.priceOverride} is null or ${t.priceOverride} between 0 and 1000000000`),
    check('employee_services_duration_ck', sql`${t.durationOverride} is null or ${t.durationOverride} between 5 and 720`),
  ],
);

/** Estilos/variantes de un servicio (ej. "Corte" → "Fade", "Clásico"), con precio y duración propios. */
export const serviceVariants = pgTable(
  'service_variants',
  {
    id: id(),
    businessId: businessRef(),
    itemId: uuid('item_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    price: integer('price').notNull(),
    durationMinutes: integer('duration_minutes'),
    photoFile: text('photo_file'),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    foreignKey({ columns: [t.itemId, t.businessId], foreignColumns: [items.id, items.businessId], name: 'service_variants_item_business_fk' }).onDelete('cascade'),
    unique('service_variants_id_business_uq').on(t.id, t.businessId),
    index('service_variants_item_idx').on(t.itemId, t.sortOrder),
    check('service_variants_price_ck', sql`${t.price} between 0 and 1000000000`),
    check('service_variants_duration_ck', sql`${t.durationMinutes} is null or ${t.durationMinutes} between 5 and 720`),
  ],
);

/** Paquetes de servicios con precio y duración propios. */
export const servicePackages = pgTable(
  'service_packages',
  {
    id: id(),
    businessId: businessRef(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    price: integer('price').notNull(),
    durationMinutes: integer('duration_minutes'),
    photoFile: text('photo_file'),
    active: boolean('active').notNull().default(true),
    visibleOnWeb: boolean('visible_on_web').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('service_packages_id_business_uq').on(t.id, t.businessId),
    index('service_packages_business_idx').on(t.businessId, t.sortOrder),
    check('service_packages_price_ck', sql`${t.price} between 0 and 1000000000`),
  ],
);

export const servicePackageEntries = pgTable(
  'service_package_entries',
  {
    id: id(),
    businessId: businessRef(),
    packageId: uuid('package_id').notNull(),
    itemId: uuid('item_id').notNull(),
    variantId: uuid('variant_id'),
  },
  (t) => [
    foreignKey({ columns: [t.packageId, t.businessId], foreignColumns: [servicePackages.id, servicePackages.businessId], name: 'service_package_entries_package_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.itemId, t.businessId], foreignColumns: [items.id, items.businessId], name: 'service_package_entries_item_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.variantId, t.businessId], foreignColumns: [serviceVariants.id, serviceVariants.businessId], name: 'service_package_entries_variant_fk' }).onDelete('set null'),
    index('service_package_entries_package_idx').on(t.packageId),
  ],
);

/**
 * Citas. Los instantes van en UTC. `busy_until` = fin del servicio + tiempo de limpieza: es lo que ocupa el calendario.
 * La migración añade una restricción de EXCLUSIÓN (btree_gist) que impide que dos citas activas del mismo profesional se
 * crucen: es la garantía real contra el doble agendamiento, aunque dos reservas lleguen exactamente a la vez.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: id(),
    businessId: businessRef(),
    clientId: uuid('client_id').notNull(),
    professionalId: uuid('professional_id').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    busyUntil: ts('busy_until').notNull(),
    status: text('status').notNull().default('pending'),
    source: text('source').notNull(),
    customerNotes: text('customer_notes').notNull().default(''),
    internalNotes: text('internal_notes').notNull().default(''),
    totalPrice: integer('total_price').notNull().default(0),
    durationMinutes: integer('duration_minutes').notNull(),
    /** Hash SHA-256 del token de gestión que recibe el cliente (el token en claro no se guarda). */
    tokenHash: text('token_hash'),
    tokenExpiresAt: ts('token_expires_at'),
    /** Hash SHA-256 de (negocio + clave de idempotencia) de la confirmación pública: un reintento de la misma confirmación devuelve esta cita. */
    idempotencyHash: text('idempotency_hash'),
    modificationCount: integer('modification_count').notNull().default(0),
    termsAcceptedAt: ts('terms_accepted_at'),
    termsAcceptedIp: text('terms_accepted_ip'),
    remindersOptIn: boolean('reminders_opt_in').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.clientId, t.businessId], foreignColumns: [clients.id, clients.businessId], name: 'appointments_client_business_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.professionalId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'appointments_professional_business_fk' }),
    unique('appointments_id_business_uq').on(t.id, t.businessId),
    uniqueIndex('appointments_token_uq').on(t.tokenHash),
    uniqueIndex('appointments_idem_uq').on(t.businessId, t.idempotencyHash).where(sql`${t.idempotencyHash} is not null`),
    index('appointments_business_start_idx').on(t.businessId, t.startsAt),
    index('appointments_professional_start_idx').on(t.businessId, t.professionalId, t.startsAt),
    index('appointments_client_idx').on(t.businessId, t.clientId),
    check('appointments_status_ck', sql`${t.status} in ('pending','confirmed','in_progress','completed','cancelled','no_show')`),
    check('appointments_source_ck', sql`${t.source} in ('app','web','walk_in')`),
    check('appointments_order_ck', sql`${t.startsAt} < ${t.endsAt} and ${t.endsAt} <= ${t.busyUntil}`),
    check('appointments_total_ck', sql`${t.totalPrice} between 0 and 1000000000`),
  ],
);

/** Lo reservado en una cita, con precio y duración CONGELADOS al momento de reservar. */
export const appointmentItems = pgTable(
  'appointment_items',
  {
    id: id(),
    businessId: businessRef(),
    appointmentId: uuid('appointment_id').notNull(),
    kind: text('kind').notNull(),
    itemId: uuid('item_id'),
    variantId: uuid('variant_id'),
    packageId: uuid('package_id'),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(0),
    quantity: integer('quantity').notNull().default(1),
  },
  (t) => [
    foreignKey({ columns: [t.appointmentId, t.businessId], foreignColumns: [appointments.id, appointments.businessId], name: 'appointment_items_appointment_fk' }).onDelete('cascade'),
    index('appointment_items_appointment_idx').on(t.appointmentId),
    check('appointment_items_kind_ck', sql`${t.kind} in ('service','package','product')`),
    check('appointment_items_qty_ck', sql`${t.quantity} between 1 and 20`),
  ],
);

/** Historial de cada cita (auditoría): quién la creó, movió, confirmó o canceló. Nunca se guardan datos personales del cliente. */
export const appointmentEvents = pgTable(
  'appointment_events',
  {
    id: id(),
    businessId: businessRef(),
    appointmentId: uuid('appointment_id').notNull(),
    type: text('type').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    data: jsonb('data').$type<Record<string, string | number | boolean | null>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.appointmentId, t.businessId], foreignColumns: [appointments.id, appointments.businessId], name: 'appointment_events_appointment_fk' }).onDelete('cascade'),
    index('appointment_events_appointment_idx').on(t.appointmentId, t.createdAt),
    check('appointment_events_actor_ck', sql`${t.actorKind} in ('staff','client','system')`),
  ],
);

/** Reseñas de citas completadas (una por cita), con moderación del negocio. */
export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    businessId: businessRef(),
    appointmentId: uuid('appointment_id').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment').notNull().default(''),
    /** Nombre y primera letra del apellido ("María P."): lo único del cliente que se muestra. */
    authorName: text('author_name').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.appointmentId, t.businessId], foreignColumns: [appointments.id, appointments.businessId], name: 'reviews_appointment_fk' }).onDelete('cascade'),
    uniqueIndex('reviews_appointment_uq').on(t.appointmentId),
    index('reviews_business_status_idx').on(t.businessId, t.status, t.createdAt.desc()),
    check('reviews_rating_ck', sql`${t.rating} between 1 and 5`),
    check('reviews_status_ck', sql`${t.status} in ('pending','approved','hidden')`),
  ],
);
