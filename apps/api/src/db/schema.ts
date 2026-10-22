import { sql } from 'drizzle-orm';
import { boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { BookingSettings, BusinessHours, CustomField, PublicSection } from '@xiro/shared';
import { clientSearchText, itemSearchText } from './search';

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
    /** NIT o cédula del negocio, para la factura de suscripción; opcional — una factura sin él solo omite esa línea. */
    taxId: text('tax_id').notNull().default(''),
    currency: text('currency').notNull().default('COP'),
    timezone: text('timezone').notNull().default('America/Bogota'),
    hours: jsonb('hours').$type<BusinessHours>().notNull(),
    logoFile: text('logo_file'),
    /**
     * Acceso a XIRO decidido por la administración de la plataforma (panel del fundador, ver routes/platform.ts). Es
     * independiente del pago: `subscriptions` dice si el negocio pagó; esto dice si puede entrar. 'suspended' y
     * 'deactivated' (baja lógica, recuperable) bloquean el inicio de sesión, la API del negocio y sus páginas públicas.
     * Solo lo cambian los servicios de platform/, siempre con auditoría.
     */
    accessStatus: text('access_status').notNull().default('active'),
    accessStatusChangedAt: ts('access_status_changed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('businesses_slug_uq').on(t.slug),
    check('businesses_type_ck', sql`${t.type} in ('barbershop','beauty_salon','spa','nails','other')`),
    check('businesses_currency_ck', sql`${t.currency} in ('COP','USD','MXN','EUR')`),
    check('businesses_access_status_ck', sql`${t.accessStatus} in ('active','suspended','deactivated')`),
    // Panel de plataforma: altas por período (gráfica histórica) sin recorrer toda la tabla.
    index('businesses_created_idx').on(t.createdAt),
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
    /** Foto de la cuenta (opcional): igual que la de un profesional, cuadrada y en WebP. Nunca se expone si es de otro negocio. */
    photoFile: text('photo_file'),
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
    // Búsqueda sin tildes por nombre o referencia (la misma expresión que usa GET /items, ver db/search.ts) con el
    // negocio DENTRO del índice (btree_gin). Medido en test/indexes.test.ts.
    index('items_search_trgm_idx').using('gin', t.businessId, sql`(${itemSearchText(t.name, t.referenceCode)}) gin_trgm_ops`),
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
    /** Foto opcional del cliente (cuadrada, WebP — mismo procesamiento que la de un profesional/cuenta). */
    photoFile: text('photo_file'),
    /** Cliente compartido "de mostrador" para ventas sin ficha (ver ventas.clientLabel para el nombre de cada recibo).
     * Nunca aparece en el directorio de clientes ni cuenta como cliente nuevo; una fila por negocio, creada bajo pedido. */
    isOccasional: boolean('is_occasional').notNull().default(false),
    /** Opcional (AAAA-MM-DD). Solo se usa para el programa de cumpleaños del negocio; nunca sale en listados ni avisos. */
    birthDate: date('birth_date', { mode: 'string' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('clients_business_name_idx').on(t.businessId, sql`lower(${t.name})`),
    unique('clients_id_business_uq').on(t.id, t.businessId),
    // Búsqueda "contiene" (ILIKE '%…%') por nombre, correo o teléfono: trigramas sobre los tres juntos (db/search.ts)
    // con el negocio DENTRO del índice (btree_gin). Medido en test/indexes.test.ts.
    index('clients_search_trgm_idx').using('gin', t.businessId, sql`${clientSearchText(t.name, t.email, t.phone)} gin_trgm_ops`),
    // Clientes recientes (actividad del Inicio, "nuevos hoy/este mes") y la paginación sort=recent.
    index('clients_business_created_idx').on(t.businessId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    // Deduplicar por teléfono en CADA reserva pública (antes: recorrer todos los clientes del negocio).
    index('clients_business_phone_idx').on(t.businessId, t.phone),
  ],
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

/**
 * Un comprobante por cada pago de suscripción CONFIRMADO (no por cada evento de webhook: ver dónde se inserta en
 * subscriptions.ts/webhooks.ts). El monto y las fechas quedan CONGELADOS al momento del pago — si el precio del plan
 * cambia después, los comprobantes ya emitidos no cambian. Nunca se borra ni se edita: es el historial de pagos.
 */
export const subscriptionInvoices = pgTable(
  'subscription_invoices',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    plan: text('plan').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    paymentMethod: text('payment_method').notNull(),
    /** Id de la transacción en el proveedor (factura de Stripe, venta de PayPal…) o "bank_transfer:<fecha>" para transferencia manual. */
    externalPaymentId: text('external_payment_id'),
    periodStart: ts('period_start').notNull(),
    /** Fecha de vencimiento / próxima renovación que se muestra en el comprobante. */
    periodEnd: ts('period_end').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('subscription_invoices_business_idx').on(t.businessId, t.createdAt.desc()),
    check('subscription_invoices_plan_ck', sql`${t.plan} in ('monthly','yearly')`),
    check('subscription_invoices_payment_method_ck', sql`${t.paymentMethod} in ('card','paypal','bank_transfer')`),
    check('subscription_invoices_amount_ck', sql`${t.amount} >= 0 and ${t.amount} <= 1000000000`),
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
    /** 'service' o 'product': de qué tipo era el artículo cobrado (Tarea 5), para separar el valor de los servicios
     * del de los productos en Inicio/Reportes sin adivinarlo por `itemId` (una línea a mano sin guardar en catálogo no
     * tiene item que consultar). Por defecto 'service': antes de esta columna, la única puerta para crear un registro
     * manual era "Registrar servicio", siempre un servicio. */
    kind: text('kind').notNull().default('service'),
    /** Cita de la que salió este cobro (al completarla). Sin cita = registro manual. */
    appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    /** true si la venta que lo generó fue anulada: deja de contar en Inicio/Reportes/Fidelización sin borrar el historial. */
    voided: boolean('voided').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('service_records_client_idx').on(t.businessId, t.clientId, t.createdAt.desc()),
    index('service_records_business_idx').on(t.businessId, t.createdAt.desc()),
    // + service_records_balance_idx (negocio, fecha) INCLUDE (monto, tipo) WHERE vigente: solo en drizzle/0036 (Drizzle no expresa INCLUDE).
    index('service_records_appointment_idx').on(t.appointmentId),
    check('service_records_amount_ck', sql`${t.amount} >= 0 and ${t.amount} <= 1000000000`),
    check('service_records_kind_ck', sql`${t.kind} in ('service','product')`),
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
  (t) => [
    index('loyalty_redemptions_client_idx').on(t.businessId, t.clientId, t.redeemedAt.desc()),
    // Historial de canjes de todo el negocio, paginado (el índice de arriba empieza por el cliente).
    index('loyalty_redemptions_business_idx').on(t.businessId, t.redeemedAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
  ],
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
  clientsEnabled: boolean('clients_enabled').notNull().default(true),
  salesEnabled: boolean('sales_enabled').notNull().default(true),
  inventoryEnabled: boolean('inventory_enabled').notNull().default(true),
  employeesEnabled: boolean('employees_enabled').notNull().default(true),
  securityEnabled: boolean('security_enabled').notNull().default(true),
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
    /**
     * El build nativo de este dispositivo incluye el sonido de Xiro y su canal de Android (lo declara al registrarse). Por
     * defecto false: los dispositivos registrados antes siguen recibiendo los avisos como siempre.
     */
    customSound: boolean('custom_sound').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('push_tokens_user_token_uq').on(t.userId, t.token),
    index('push_tokens_business_idx').on(t.businessId),
    check('push_tokens_platform_ck', sql`${t.platform} in ('expo','web')`),
  ],
);

/**
 * Historial de notificaciones EN LA APP, por destinatario (un dueño o un empleado): se guarda SIEMPRE que ocurre el
 * evento (cita nueva, premio de fidelización, problema de facturación…), sin importar si esa persona tiene permiso de
 * push o si desactivó la categoría — esos interruptores solo deciden si además se manda un aviso al dispositivo (ver
 * `push.ts`). Antes de esta tabla, el centro de notificaciones de la app NO tenía relación con los avisos push: uno
 * podía llegar al teléfono y nunca aparecer aquí, o aparecer aquí sin que nadie lo hubiera visto. `dedupeKey` es la
 * clave de idempotencia (sección "notificaciones duplicadas"): el mismo evento real, para la misma persona, nunca
 * crea una segunda fila, así el emisor pueda reintentar con total tranquilidad (p. ej. un webhook reenviado).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    titleKey: text('title_key').notNull(),
    bodyKey: text('body_key').notNull(),
    params: jsonb('params').$type<Record<string, string | number>>().notNull().default(sql`'{}'::jsonb`),
    /** Ruta dentro de la app a la que lleva al tocarla ("/agenda", "/client/:id", "/subscription"…); null = sin destino específico. */
    href: text('href'),
    read: boolean('read').notNull().default(false),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notifications_user_dedupe_uq').on(t.userId, t.dedupeKey),
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
    check('notifications_category_ck', sql`${t.category} in ('appointments','reviews','loyalty','billing','clients','sales','inventory','employees','security')`),
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
    /** Marca del negocio en su página (Fase 3 del plan): color de acento (#rrggbb; null = dorado por defecto). */
    accentColor: text('accent_color'),
    /** Título de la página de reservas ('' = el texto por defecto, "Reserva tu experiencia"). */
    bookingTitle: text('booking_title').notNull().default(''),
    /** Hasta 3 avisos de confianza propios del negocio (p. ej. "Sin pago anticipado"); vacío = no se muestra ninguno. */
    trustBadges: jsonb('trust_badges').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('bpp_coords_ck', sql`(${t.latitude} is null) = (${t.longitude} is null)`),
    check('bpp_accent_ck', sql`${t.accentColor} is null or ${t.accentColor} ~ '^#[0-9a-f]{6}$'`),
  ],
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
    /** Un producto publicado en 0 existencias: true = se oculta del catálogo público; false = sigue visible, marcado "Agotado". */
    hideOutOfStockInCatalog: boolean('hide_out_of_stock_in_catalog').notNull().default(false),
    /** Pedidos de solo productos desde la página pública (recoger y pagar en el local). Apagado por defecto: cada negocio decide. */
    productOrdersEnabled: boolean('product_orders_enabled').notNull().default(false),
    /* Funciones de la Fase 4 del plan: cada negocio decide (todas apagadas por defecto, salvo el recordatorio de siempre). */
    /** Horas antes de la cita en que se recuerda (hasta 3; p. ej. [24, 2]). Por defecto [3], el recordatorio de siempre. */
    reminderHours: jsonb('reminder_hours').$type<number[]>().notNull().default(sql`'[3]'::jsonb`),
    waitlistEnabled: boolean('waitlist_enabled').notNull().default(false),
    discountCodesEnabled: boolean('discount_codes_enabled').notNull().default(false),
    reviewRequestsEnabled: boolean('review_requests_enabled').notNull().default(false),
    rememberCustomerEnabled: boolean('remember_customer_enabled').notNull().default(false),
    /** Distintivo "✓ Reserva fácil · Sin pago anticipado" en la cabecera pública (solo si el negocio lo activa). */
    noPrepayBadgeEnabled: boolean('no_prepay_badge_enabled').notNull().default(false),
    /** Campo de comentarios del cliente al reservar (encendido por defecto: así era siempre). */
    customerNotesEnabled: boolean('customer_notes_enabled').notNull().default(true),
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
    /** Especialidad que se muestra en la página pública (p. ej. "Colorista"); '' = no se muestra. */
    specialty: text('specialty').notNull().default(''),
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
 * Cuenta de cliente final (opcional, página pública): quien reserva puede guardar sus datos para no volver a
 * escribirlos, sin que eso sea obligatorio — agendar como invitado sigue funcionando exactamente igual. Distinta de
 * `users` (dueño y empleados del negocio): una cuenta pertenece a UN SOLO negocio, nunca es una identidad global —
 * el mismo teléfono en dos negocios son dos cuentas independientes, cada una con su propia contraseña
 * (`client_accounts_business_phone_uq`). Vinculada 1 a 1 con un `clients` del mismo negocio (el registro de cliente
 * que el negocio ya tenía, o uno nuevo creado al registrarse) — así el dueño sigue viendo un solo directorio.
 */
export const clientAccounts = pgTable(
  'client_accounts',
  {
    id: id(),
    businessId: businessRef(),
    clientId: uuid('client_id').notNull(),
    phoneE164: text('phone_e164').notNull(),
    phoneVerifiedAt: ts('phone_verified_at'),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    photoFile: text('photo_file'),
    language: text('language'),
    /** true tras un restablecimiento hecho por el negocio (ver client_audit_log): debe elegir una contraseña propia
     * antes de seguir — así el negocio nunca llega a conocer la definitiva. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    tempPasswordExpiresAt: ts('temp_password_expires_at'),
    createdAt: createdAt(),
    lastLoginAt: ts('last_login_at'),
    disabledAt: ts('disabled_at'),
  },
  (t) => [
    foreignKey({ columns: [t.clientId, t.businessId], foreignColumns: [clients.id, clients.businessId], name: 'client_accounts_client_business_fk' }).onDelete('cascade'),
    unique('client_accounts_id_business_uq').on(t.id, t.businessId),
    uniqueIndex('client_accounts_business_phone_uq').on(t.businessId, t.phoneE164),
    uniqueIndex('client_accounts_client_uq').on(t.clientId),
  ],
);

/** Sesiones del navegador de una cuenta de cliente (sesión "permanente": hasta 180 días, deslizante). El token en
 * claro nunca se guarda, solo su hash — igual que `refresh_tokens` de `users`. */
export const clientSessions = pgTable(
  'client_sessions',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    deviceLabel: text('device_label').notNull().default(''),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('client_sessions_token_uq').on(t.tokenHash), index('client_sessions_account_idx').on(t.accountId)],
);

/** Token de un solo uso entre "código verificado" y "contraseña cambiada" — mismo patrón que `reset_tokens` de `users`. */
export const clientResetTokens = pgTable(
  'client_reset_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('client_reset_account_idx').on(t.accountId), index('client_reset_expires_idx').on(t.expiresAt)],
);

/** Códigos de recuperación de acceso de una cuenta de cliente ("Olvidé mi contraseña") — mismo patrón de un solo uso que `otp_codes` de `users`. */
export const clientRecoveryCodes = pgTable(
  'client_recovery_codes',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => clientAccounts.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    channel: text('channel').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('client_recovery_codes_account_idx').on(t.accountId), check('client_recovery_codes_channel_ck', sql`${t.channel} in ('sms','whatsapp','email')`)],
);

/** Auditoría mínima del acceso en línea de un cliente (p. ej. "el negocio restableció tu contraseña"). Sin contraseñas ni códigos. */
export const clientAuditLog = pgTable(
  'client_audit_log',
  {
    id: id(),
    businessId: businessRef(),
    accountId: uuid('account_id'),
    action: text('action').notNull(),
    actorUserId: uuid('actor_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.actorUserId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'client_audit_log_actor_fk' }).onDelete('set null'),
    index('client_audit_log_business_idx').on(t.businessId, t.createdAt.desc()),
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
    /** Código de descuento usado (Fase 4) y cuánto descontó; el total bruto (`totalPrice`) no cambia: se cobra totalPrice − discountAmount. */
    discountCodeId: uuid('discount_code_id').references(() => discountCodes.id, { onDelete: 'set null' }),
    discountAmount: integer('discount_amount').notNull().default(0),
    modificationCount: integer('modification_count').notNull().default(0),
    termsAcceptedAt: ts('terms_accepted_at'),
    termsAcceptedIp: text('terms_accepted_ip'),
    remindersOptIn: boolean('reminders_opt_in').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** Cuenta de cliente que hizo la reserva (si inició sesión); null = invitado, o un cambio de teléfono en esa
     * cita la desvinculó. La fidelización cuenta por `clientId`, no por este campo — un cambio de teléfono en la
     * cita no le hace perder su avance. */
    clientAccountId: uuid('client_account_id'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.clientId, t.businessId], foreignColumns: [clients.id, clients.businessId], name: 'appointments_client_business_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.professionalId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'appointments_professional_business_fk' }),
    foreignKey({ columns: [t.clientAccountId, t.businessId], foreignColumns: [clientAccounts.id, clientAccounts.businessId], name: 'appointments_client_account_business_fk' }).onDelete('set null'),
    unique('appointments_id_business_uq').on(t.id, t.businessId),
    uniqueIndex('appointments_token_uq').on(t.tokenHash),
    uniqueIndex('appointments_idem_uq').on(t.businessId, t.idempotencyHash).where(sql`${t.idempotencyHash} is not null`),
    index('appointments_business_start_idx').on(t.businessId, t.startsAt),
    index('appointments_professional_start_idx').on(t.businessId, t.professionalId, t.startsAt),
    index('appointments_client_idx').on(t.businessId, t.clientId),
    // Fase 5: la llave foránea al código de descuento (borrar un código pone NULL aquí) sin recorrer todas las citas.
    index('appointments_discount_code_idx').on(t.discountCodeId).where(sql`${t.discountCodeId} is not null`),
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

/* =====================================================================================================================
 * MENSAJERÍA INTERNA: chat 1 a 1 entre personas del MISMO negocio (dueño y empleados; nunca con un cliente, que no
 * inicia sesión). `userAId`/`userBId` van siempre en orden (el menor primero): así el par tiene una sola fila, sin
 * importar quién empezó la conversación. Con RLS (como las tablas de citas) desde que nace, no como una fase aparte.
 * ===================================================================================================================== */

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    businessId: businessRef(),
    userAId: uuid('user_a_id').notNull(),
    userBId: uuid('user_b_id').notNull(),
    /** Se toca con cada mensaje nuevo: ordena la lista de chats por actividad reciente sin unir con `messages`. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.userAId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'conversations_user_a_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.userBId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'conversations_user_b_fk' }).onDelete('cascade'),
    // Necesaria para que `messages` pueda referenciar (id, business_id) con una FK compuesta (igual que `users_id_business_uq`).
    unique('conversations_id_business_uq').on(t.id, t.businessId),
    unique('conversations_pair_uq').on(t.businessId, t.userAId, t.userBId),
    index('conversations_business_idx').on(t.businessId, t.lastMessageAt.desc()),
    check('conversations_order_ck', sql`${t.userAId} < ${t.userBId}`),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    businessId: businessRef(),
    conversationId: uuid('conversation_id').notNull(),
    senderId: uuid('sender_id').notNull(),
    content: text('content').notNull(),
    /** null = todavía sin leer por la otra persona. */
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.conversationId, t.businessId], foreignColumns: [conversations.id, conversations.businessId], name: 'messages_conversation_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.senderId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'messages_sender_fk' }),
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    check('messages_content_ck', sql`length(${t.content}) > 0 and length(${t.content}) <= 4000`),
  ],
);

/* =====================================================================================================================
 * VENTAS: el punto de venta (servicios y productos, del catálogo o a mano, con pago). Cada línea de servicio o producto
 * sigue alimentando `service_records` a través de `recordService` (misma función que usa cerrar una cita): así Inicio,
 * Reportes, Fidelización e historial del cliente ven exactamente lo mismo que antes, vengan de una cita o de una venta.
 * Los nombres y precios de cada línea quedan CONGELADOS al momento de la venta (no cambian si después se edita el
 * catálogo). No se borra ninguna venta: se anula, con motivo, y queda registrada en la bitácora.
 * ===================================================================================================================== */

export const sales = pgTable(
  'sales',
  {
    id: id(),
    businessId: businessRef(),
    /** null = cliente ocasional (no se creó una ficha). */
    clientId: uuid('client_id'),
    /** Nombre a mostrar cuando no hay `clientId` ("Cliente ocasional" u otro que se haya escrito). */
    clientLabel: text('client_label').notNull().default(''),
    subtotal: integer('subtotal').notNull(),
    discount: integer('discount').notNull().default(0),
    tip: integer('tip').notNull().default(0),
    total: integer('total').notNull(),
    status: text('status').notNull().default('completed'),
    voidReason: text('void_reason').notNull().default(''),
    voidedBy: uuid('voided_by'),
    voidedAt: ts('voided_at'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sales_id_business_uq').on(t.id, t.businessId),
    foreignKey({ columns: [t.clientId, t.businessId], foreignColumns: [clients.id, clients.businessId], name: 'sales_client_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.createdBy, t.businessId], foreignColumns: [users.id, users.businessId], name: 'sales_created_by_fk' }),
    foreignKey({ columns: [t.voidedBy, t.businessId], foreignColumns: [users.id, users.businessId], name: 'sales_voided_by_fk' }),
    index('sales_business_idx').on(t.businessId, t.createdAt.desc()),
    // + sales_balance_idx (negocio, fecha) INCLUDE (descuento, propina) WHERE completada: solo en drizzle/0036 (Drizzle no expresa INCLUDE).
    index('sales_client_idx').on(t.clientId),
    check('sales_status_ck', sql`${t.status} in ('completed','voided')`),
    check('sales_amounts_ck', sql`${t.subtotal} >= 0 and ${t.discount} >= 0 and ${t.tip} >= 0 and ${t.total} >= 0`),
  ],
);

export const saleItems = pgTable(
  'sale_items',
  {
    id: id(),
    businessId: businessRef(),
    saleId: uuid('sale_id').notNull(),
    kind: text('kind').notNull(),
    /** Artículo del catálogo; null = servicio o producto escrito a mano en esta venta. */
    itemId: uuid('item_id'),
    /** Nombre congelado al momento de la venta. */
    name: text('name').notNull(),
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull().default(1),
    total: integer('total').notNull(),
    /** Quién hizo el servicio (comisiones y reportes). Solo aplica a servicios. */
    employeeId: uuid('employee_id'),
    /** El cobro que representa esta línea en `service_records` (sello de fidelización si aplicaba). */
    serviceRecordId: uuid('service_record_id'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.saleId, t.businessId], foreignColumns: [sales.id, sales.businessId], name: 'sale_items_sale_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.itemId, t.businessId], foreignColumns: [items.id, items.businessId], name: 'sale_items_item_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.employeeId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'sale_items_employee_fk' }).onDelete('set null'),
    index('sale_items_sale_idx').on(t.saleId),
    index('sale_items_item_idx').on(t.itemId),
    check('sale_items_kind_ck', sql`${t.kind} in ('service','product')`),
    check('sale_items_amounts_ck', sql`${t.quantity} > 0 and ${t.unitPrice} >= 0 and ${t.total} >= 0`),
  ],
);

export const salePayments = pgTable(
  'sale_payments',
  {
    id: id(),
    businessId: businessRef(),
    saleId: uuid('sale_id').notNull(),
    method: text('method').notNull(),
    amount: integer('amount').notNull(),
    /** Solo en efectivo: cuánto entregó la persona (para calcular el cambio). null = pagó el monto exacto. */
    receivedAmount: integer('received_amount'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.saleId, t.businessId], foreignColumns: [sales.id, sales.businessId], name: 'sale_payments_sale_fk' }).onDelete('cascade'),
    index('sale_payments_sale_idx').on(t.saleId),
    check('sale_payments_method_ck', sql`${t.method} in ('cash','card','nequi','bank_transfer','other')`),
    check('sale_payments_amount_ck', sql`${t.amount} > 0 and (${t.receivedAmount} is null or ${t.receivedAmount} >= ${t.amount})`),
  ],
);

/* =====================================================================================================================
 * GASTOS Y CIERRE DE CAJA (Tarea 8)
 * `expenses` son salidas de caja (gastos, retiros) del día; solo las pagadas en efectivo afectan el conteo físico.
 * `cash_closings` es la CONCILIACIÓN de un día: lo único que se congela es lo que no tiene otra fuente (la base con la
 * que se abrió ese día y lo que la persona contó físicamente); el resto del resumen (ventas por método, top servicios,
 * comisiones…) se recalcula al leerlo a partir de `sales`/`service_records`/`expenses`, que ya son inmutables por su
 * cuenta. Un cierre guardado nunca se edita: solo se anula con motivo, y solo entonces se puede volver a cerrar ese día.
 * ===================================================================================================================== */

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    businessId: businessRef(),
    amount: integer('amount').notNull(),
    description: text('description').notNull(),
    /** Solo 'cash' resta de la caja física; otros métodos no afectan el efectivo contado (pero sí el gasto del día). */
    method: text('method').notNull().default('cash'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    /* ---- Módulo Finanzas (migración 0033): todo aditivo; los gastos anteriores quedan como "operativo · otros". ---- */
    /** 'operating' (operativo) | 'payroll' (nómina). */
    type: text('type').notNull().default('operating'),
    /** Código de categoría (catálogo en @xiro/shared/expenses, ampliable sin migración). */
    category: text('category').notNull().default('other'),
    /** Día del gasto en la zona del negocio (lo que usa el Balance). */
    expenseDate: date('expense_date', { mode: 'string' }).notNull().defaultNow(),
    /** Empleado que recibe el pago (obligatorio en nómina). */
    employeeId: uuid('employee_id'),
    notes: text('notes').notNull().default(''),
    /** Salió del efectivo de la caja del día (se resta del esperado en el arqueo). */
    paidFromCash: boolean('paid_from_cash').notNull().default(false),
    /** Apertura de caja (del día) de la que salió, si aplica. */
    cashOpeningId: uuid('cash_opening_id').references(() => cashOpenings.id, { onDelete: 'set null' }),
    /** 'active' | 'voided' (anulación con motivo; nunca se borra). */
    status: text('status').notNull().default('active'),
    voidReason: text('void_reason').notNull().default(''),
    voidedBy: uuid('voided_by'),
    voidedAt: ts('voided_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.createdBy, t.businessId], foreignColumns: [users.id, users.businessId], name: 'expenses_created_by_fk' }),
    foreignKey({ columns: [t.employeeId, t.businessId], foreignColumns: [users.id, users.businessId], name: 'expenses_employee_fk' }),
    foreignKey({ columns: [t.voidedBy, t.businessId], foreignColumns: [users.id, users.businessId], name: 'expenses_voided_by_fk' }),
    index('expenses_business_idx').on(t.businessId, t.createdAt.desc()),
    index('expenses_business_date_idx').on(t.businessId, t.expenseDate.desc()),
    index('expenses_business_employee_idx').on(t.businessId, t.employeeId).where(sql`${t.employeeId} is not null`),
    check('expenses_method_ck', sql`${t.method} in ('cash','card','nequi','bank_transfer','other')`),
    check('expenses_amount_ck', sql`${t.amount} > 0 and ${t.amount} <= 1000000000`),
    check('expenses_type_ck', sql`${t.type} in ('operating','payroll')`),
    check('expenses_status_ck', sql`${t.status} in ('active','voided')`),
    check('expenses_payroll_employee_ck', sql`${t.type} <> 'payroll' or ${t.employeeId} is not null`),
    check('expenses_cash_method_ck', sql`not ${t.paidFromCash} or ${t.method} = 'cash'`),
  ],
);

/**
 * Ajustes explícitos a gastos de una caja YA CERRADA (Finanzas, fase 2): el cierre firmado no se toca, pero toda corrección
 * posterior (editar o anular un gasto que salió de esa caja) queda registrada aquí con su motivo, el antes y el después, quién
 * y cuándo. Solo se agrega (nunca se edita ni se borra).
 */
export const expenseAdjustments = pgTable(
  'expense_adjustments',
  {
    id: id(),
    businessId: businessRef(),
    expenseId: uuid('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    /** Día de caja (cerrada) que afecta. */
    cashDay: date('cash_day', { mode: 'string' }).notNull(),
    /** 'edit' | 'void'. */
    kind: text('kind').notNull(),
    reason: text('reason').notNull(),
    /** Monto que salía de la caja antes y después del ajuste (0 si dejó de salir de ella). */
    amountBefore: integer('amount_before').notNull(),
    amountAfter: integer('amount_after').notNull(),
    /** Copia de los campos del gasto antes y después (para auditoría). */
    before: jsonb('before').$type<Record<string, unknown>>().notNull(),
    after: jsonb('after').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.createdBy, t.businessId], foreignColumns: [users.id, users.businessId], name: 'expense_adjustments_created_by_fk' }),
    index('expense_adjustments_expense_idx').on(t.businessId, t.expenseId),
    index('expense_adjustments_day_idx').on(t.businessId, t.cashDay),
    check('expense_adjustments_kind_ck', sql`${t.kind} in ('edit','void')`),
  ],
);

export const cashClosings = pgTable(
  'cash_closings',
  {
    id: id(),
    businessId: businessRef(),
    /** Día local del negocio que se cierra (AAAA-MM-DD). */
    day: date('day', { mode: 'string' }).notNull(),
    openingAmount: integer('opening_amount').notNull(),
    countedAmount: integer('counted_amount').notNull(),
    expectedAmount: integer('expected_amount').notNull(),
    /** counted − expected: positivo = sobrante, negativo = faltante. */
    difference: integer('difference').notNull(),
    totalSales: integer('total_sales').notNull(),
    totalTip: integer('total_tip').notNull(),
    totalExpenses: integer('total_expenses').notNull(),
    note: text('note').notNull().default(''),
    status: text('status').notNull().default('completed'),
    voidReason: text('void_reason').notNull().default(''),
    voidedBy: uuid('voided_by'),
    voidedAt: ts('voided_at'),
    closedBy: uuid('closed_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Único ACTIVO por día (no total): tras anular un cierre, ese día se puede volver a cerrar.
    uniqueIndex('cash_closings_business_day_active_uq').on(t.businessId, t.day).where(sql`${t.status} = 'completed'`),
    foreignKey({ columns: [t.closedBy, t.businessId], foreignColumns: [users.id, users.businessId], name: 'cash_closings_closed_by_fk' }),
    foreignKey({ columns: [t.voidedBy, t.businessId], foreignColumns: [users.id, users.businessId], name: 'cash_closings_voided_by_fk' }),
    index('cash_closings_business_idx').on(t.businessId, t.day.desc()),
    check('cash_closings_status_ck', sql`${t.status} in ('completed','voided')`),
  ],
);

/* ---------- Pedidos de solo productos (página pública) ---------- */

/**
 * Un cliente pide productos para recoger y pagar en el local, sin cita (sin hora ni profesional). Los precios y el total
 * los fija el servidor al crear el pedido. El inventario NO se toca aquí: se descuenta cuando el negocio lo entrega,
 * registrándolo como una venta normal (`saleId`), igual que los productos apartados en una cita.
 * Estados: pending (nuevo) → ready (listo para recoger) → delivered (entregado, con venta) | cancelled.
 */
export const productOrders = pgTable(
  'product_orders',
  {
    id: id(),
    businessId: businessRef(),
    clientId: uuid('client_id').notNull(),
    /** Cuenta de cliente de la página pública con la que se pidió, si inició sesión; null = invitado. */
    clientAccountId: uuid('client_account_id').references(() => clientAccounts.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('pending'),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: text('customer_email'),
    customerNotes: text('customer_notes').notNull().default(''),
    totalPrice: integer('total_price').notNull(),
    idempotencyHash: text('idempotency_hash'),
    /** Código de descuento usado (Fase 4) y cuánto descontó; el total bruto (`totalPrice`) no cambia: se cobra totalPrice − discountAmount. */
    discountCodeId: uuid('discount_code_id').references(() => discountCodes.id, { onDelete: 'set null' }),
    discountAmount: integer('discount_amount').notNull().default(0),
    termsAcceptedAt: ts('terms_accepted_at'),
    termsAcceptedIp: text('terms_accepted_ip'),
    /** Venta con la que se entregó (descuenta el inventario); null mientras no se entrega. */
    saleId: uuid('sale_id').references(() => sales.id, { onDelete: 'set null' }),
    cancelReason: text('cancel_reason').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('product_orders_id_business_uq').on(t.id, t.businessId),
    foreignKey({ columns: [t.clientId, t.businessId], foreignColumns: [clients.id, clients.businessId], name: 'product_orders_client_business_fk' }).onDelete('cascade'),
    uniqueIndex('product_orders_idem_uq').on(t.businessId, t.idempotencyHash).where(sql`${t.idempotencyHash} is not null`),
    index('product_orders_business_created_idx').on(t.businessId, t.createdAt.desc(), t.id.desc()),
    index('product_orders_business_status_idx').on(t.businessId, t.status),
    index('product_orders_discount_code_idx').on(t.discountCodeId).where(sql`${t.discountCodeId} is not null`),
    check('product_orders_status_ck', sql`${t.status} in ('pending','ready','delivered','cancelled')`),
    check('product_orders_total_ck', sql`${t.totalPrice} between 0 and 1000000000`),
    check('product_orders_delivered_sale_ck', sql`${t.status} <> 'delivered' or ${t.saleId} is not null`),
  ],
);

export const productOrderItems = pgTable(
  'product_order_items',
  {
    id: id(),
    businessId: businessRef(),
    orderId: uuid('order_id').notNull(),
    /** El producto del catálogo; si luego se borra del catálogo, el pedido conserva nombre y precio. */
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.orderId, t.businessId], foreignColumns: [productOrders.id, productOrders.businessId], name: 'product_order_items_order_fk' }).onDelete('cascade'),
    index('product_order_items_order_idx').on(t.orderId),
    check('product_order_items_qty_ck', sql`${t.quantity} between 1 and 20`),
    check('product_order_items_price_ck', sql`${t.unitPrice} between 0 and 1000000000`),
  ],
);

/* ---------- Códigos de descuento (Fase 4) ---------- */

/**
 * Código promocional de un negocio para su página pública. El servidor lo valida y calcula el descuento sobre el subtotal real
 * (nunca confía en lo que mande el navegador). `uses` se incrementa de forma atómica al confirmar (dos reservas a la vez no
 * superan `maxUses`). `code` se guarda en mayúsculas y es único por negocio.
 */
export const discountCodes = pgTable(
  'discount_codes',
  {
    id: id(),
    businessId: businessRef(),
    code: text('code').notNull(),
    description: text('description').notNull().default(''),
    /** percent = porcentaje (1–100); fixed = monto fijo en la moneda del negocio. */
    kind: text('kind').notNull(),
    value: integer('value').notNull(),
    /** Subtotal mínimo para aplicarlo (0 = sin mínimo). */
    minTotal: integer('min_total').notNull().default(0),
    /** Usos totales permitidos (null = sin tope) y usados hasta ahora. */
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    /** Solo una vez por cliente (por su ficha: celular o cuenta). */
    oncePerClient: boolean('once_per_client').notNull().default(false),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('discount_codes_business_code_uq').on(t.businessId, t.code),
    index('discount_codes_business_idx').on(t.businessId, t.createdAt.desc()),
    check('discount_codes_kind_ck', sql`${t.kind} in ('percent','fixed')`),
    check('discount_codes_value_ck', sql`(${t.kind} = 'percent' and ${t.value} between 1 and 100) or (${t.kind} = 'fixed' and ${t.value} between 1 and 1000000000)`),
    check('discount_codes_code_ck', sql`${t.code} ~ '^[A-Z0-9_-]{3,30}$'`),
    check('discount_codes_uses_ck', sql`${t.uses} >= 0 and (${t.maxUses} is null or ${t.maxUses} >= 1)`),
    check('discount_codes_dates_ck', sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.startsAt} < ${t.endsAt}`),
  ],
);

/* ---------- Lista de espera (Fase 4) ---------- */

/**
 * Alguien quiere un día que está lleno: deja sus datos y lo que quiere reservar. Cuando se libera un horario ese día
 * (cancelación o cambio), el sistema comprueba la disponibilidad REAL para su selección y avisa en orden de llegada al negocio
 * (push) y a la persona (su canal). El enlace personal (`tokenHash`: solo el hash en la base) le deja ver o quitar su lugar.
 */
export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: id(),
    businessId: businessRef(),
    clientId: uuid('client_id').notNull(),
    /** Fecha de calendario local del negocio ("AAAA-MM-DD") que quiere. */
    date: date('date', { mode: 'string' }).notNull(),
    /** Servicios elegidos (ids); con ellos se calcula si hay un horario libre que le sirva. */
    serviceIds: jsonb('service_ids').$type<string[]>().notNull(),
    /** null = cualquier profesional. */
    professionalId: uuid('professional_id'),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: text('customer_email'),
    status: text('status').notNull().default('waiting'),
    tokenHash: text('token_hash').notNull(),
    notifiedAt: ts('notified_at'),
    termsAcceptedAt: ts('terms_accepted_at').notNull(),
    termsAcceptedIp: text('terms_accepted_ip'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.clientId, t.businessId], foreignColumns: [clients.id, clients.businessId], name: 'waitlist_client_business_fk' }).onDelete('cascade'),
    uniqueIndex('waitlist_token_uq').on(t.tokenHash),
    // Una sola espera activa por cliente y día (pedirla otra vez devuelve la misma).
    uniqueIndex('waitlist_client_date_uq').on(t.businessId, t.clientId, t.date).where(sql`${t.status} = 'waiting'`),
    index('waitlist_business_date_idx').on(t.businessId, t.date, t.createdAt),
    check('waitlist_status_ck', sql`${t.status} in ('waiting','notified','cancelled')`),
  ],
);


/* =====================================================================================================================
 * Administración de la PLATAFORMA (panel del fundador). Identidades separadas por completo de las de los negocios: un
 * administrador no es un `users` (no tiene negocio) y un usuario de negocio nunca puede volverse administrador desde la API
 * (no hay ruta de alta: solo el script `npm run platform:admin`). Ninguna de estas tablas es accesible para `xiro_app`.
 * ===================================================================================================================== */

export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: id(),
    /** Siempre en minúsculas. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** Secreto TOTP (RFC 6238) CIFRADO con AES-256-GCM (clave PLATFORM_ADMIN_KEY); nunca en claro en la base. */
    totpSecretEnc: text('totp_secret_enc').notNull(),
    /** Último paso TOTP aceptado: un código ya usado no sirve otra vez (anti-repetición). */
    totpLastStep: integer('totp_last_step').notNull().default(0),
    /** El fundador tiene todos los permisos; el resto, solo los de `permissions` (PLATFORM_PERMISSIONS). */
    isFounder: boolean('is_founder').notNull().default(false),
    permissions: jsonb('permissions').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('platform_admins_email_uq').on(t.email), check('platform_admins_email_lower_ck', sql`${t.email} = lower(${t.email})`)],
);

/**
 * Sesiones de administrador: token opaco (solo su HMAC en la base), vencimiento absoluto y por inactividad, revocables al
 * instante. `mfaAt` es la última verificación TOTP: las acciones sensibles exigen que sea reciente (reautenticación).
 */
export const platformAdminSessions = pgTable(
  'platform_admin_sessions',
  {
    id: id(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    mfaAt: ts('mfa_at').notNull(),
    revokedAt: ts('revoked_at'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('platform_sessions_token_uq').on(t.tokenHash), index('platform_sessions_admin_idx').on(t.adminId)],
);

/**
 * Bitácora de la plataforma: toda lectura sensible y toda acción administrativa (también los intentos denegados o fallidos).
 * INMUTABLE desde la aplicación: un trigger rechaza UPDATE, DELETE y TRUNCATE (ver la migración). Sin FK a `businesses`
 * a propósito: el registro sobrevive aunque algún día se borre el negocio. Nunca guarda contraseñas, tokens ni cuerpos.
 */
export const platformAuditLog = pgTable(
  'platform_audit_log',
  {
    id: id(),
    /** null = intento de inicio de sesión de una cuenta inexistente. */
    adminId: uuid('admin_id').references(() => platformAdmins.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    businessId: uuid('business_id'),
    outcome: text('outcome').notNull(),
    requestId: text('request_id'),
    ip: text('ip'),
    /** Valores anteriores/nuevos, motivo, referencia de soporte… (lista blanca: ver platform/audit.ts). */
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index('platform_audit_created_idx').on(t.createdAt.desc()),
    index('platform_audit_business_idx').on(t.businessId, t.createdAt.desc()),
    index('platform_audit_admin_idx').on(t.adminId, t.createdAt.desc()),
    check('platform_audit_outcome_ck', sql`${t.outcome} in ('success','denied','error')`),
  ],
);

/**
 * Concesión administrativa de acceso (días o meses de cortesía). NO es un pago: no genera comprobante, no toca
 * `subscriptions` ni al proveedor de pagos. Da acceso entre `startsAt` y `endsAt`; revocarla la deja sin efecto (no se borra).
 * `idempotencyKey` (único) hace que un reintento o un doble clic no la dupliquen.
 */
export const businessAccessGrants = pgTable(
  'business_access_grants',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'restrict' }),
    unit: text('unit').notNull(),
    amount: integer('amount').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    reason: text('reason').notNull(),
    supportRef: text('support_ref'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => platformAdmins.id, { onDelete: 'restrict' }),
    revokeReason: text('revoke_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('access_grants_idempotency_uq').on(t.idempotencyKey),
    index('access_grants_business_idx').on(t.businessId, t.endsAt.desc()),
    check('access_grants_unit_ck', sql`${t.unit} in ('days','months')`),
    check('access_grants_amount_ck', sql`(${t.unit} = 'days' and ${t.amount} between 1 and 366) or (${t.unit} = 'months' and ${t.amount} between 1 and 24)`),
    check('access_grants_range_ck', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/* =====================================================================================================================
 * Programa de cumpleaños (opcional por negocio, apagado por defecto). Ver packages/shared/src/birthday.ts.
 * ===================================================================================================================== */

export const birthdayPrograms = pgTable(
  'birthday_programs',
  {
    id: id(),
    businessId: businessRef(),
    enabled: boolean('enabled').notNull().default(false),
    rewardKind: text('reward_kind').notNull().default('percent'),
    rewardValue: integer('reward_value').notNull().default(10),
    scope: text('scope').notNull().default('all'),
    validDays: integer('valid_days').notNull().default(7),
    minTotal: integer('min_total').notNull().default(0),
    combinable: boolean('combinable').notNull().default(false),
    message: text('message').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('birthday_programs_business_uq').on(t.businessId),
    check('birthday_programs_kind_ck', sql`${t.rewardKind} in ('percent','fixed')`),
    check('birthday_programs_value_ck', sql`(${t.rewardKind} = 'percent' and ${t.rewardValue} between 1 and 100) or (${t.rewardKind} = 'fixed' and ${t.rewardValue} between 1 and 1000000000)`),
    check('birthday_programs_scope_ck', sql`${t.scope} in ('all','services','products')`),
    check('birthday_programs_days_ck', sql`${t.validDays} between 1 and 60`),
    check('birthday_programs_min_ck', sql`${t.minTotal} >= 0`),
  ],
);

/**
 * Recompensa de cumpleaños emitida. UNA por negocio, cliente y año (`birthday_rewards_once_uq`): ni un trabajo repetido, ni
 * dos instancias a la vez, ni cambiar la fecha de nacimiento pueden emitir una segunda ese año. Las condiciones se congelan
 * al emitirla (cambiar el programa después no altera una ya emitida). `status`: available → claimed (reserva/pedido web) o
 * redeemed (venta en caja); si esa reserva/pedido se cancela o la venta se anula, vuelve a available. "Vencida" se deriva.
 */
export const birthdayRewards = pgTable(
  'birthday_rewards',
  {
    id: id(),
    businessId: businessRef(),
    clientId: uuid('client_id').notNull(),
    year: integer('year').notNull(),
    /** Día celebrado (29 feb → 28 feb en años no bisiestos) = primer día de vigencia; `endsOn` = último (inclusive). */
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    rewardKind: text('reward_kind').notNull(),
    rewardValue: integer('reward_value').notNull(),
    scope: text('scope').notNull(),
    minTotal: integer('min_total').notNull(),
    combinable: boolean('combinable').notNull(),
    status: text('status').notNull().default('available'),
    amount: integer('amount'),
    usedAt: ts('used_at'),
    saleId: uuid('sale_id').references(() => sales.id, { onDelete: 'set null' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    productOrderId: uuid('product_order_id').references(() => productOrders.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.clientId, t.businessId], foreignColumns: [clients.id, clients.businessId], name: 'birthday_rewards_client_fk' }).onDelete('cascade'),
    uniqueIndex('birthday_rewards_once_uq').on(t.businessId, t.clientId, t.year),
    index('birthday_rewards_business_idx').on(t.businessId, t.startsOn.desc()),
    index('birthday_rewards_sale_idx').on(t.saleId).where(sql`${t.saleId} is not null`),
    index('birthday_rewards_appointment_idx').on(t.appointmentId).where(sql`${t.appointmentId} is not null`),
    index('birthday_rewards_order_idx').on(t.productOrderId).where(sql`${t.productOrderId} is not null`),
    check('birthday_rewards_status_ck', sql`${t.status} in ('available','claimed','redeemed')`),
    check('birthday_rewards_kind_ck', sql`${t.rewardKind} in ('percent','fixed')`),
    check('birthday_rewards_scope_ck', sql`${t.scope} in ('all','services','products')`),
    check('birthday_rewards_range_ck', sql`${t.endsOn} >= ${t.startsOn}`),
    // Disponible ⇔ sin uso; usada ⇔ con monto y fecha. El destino (venta/cita/pedido) puede quedar en null si algún día se
    // borra esa fila (ON DELETE SET NULL): la recompensa sigue contando como usada ese año.
    check(
      'birthday_rewards_use_ck',
      sql`(${t.status} = 'available' and ${t.amount} is null and ${t.usedAt} is null and ${t.saleId} is null and ${t.appointmentId} is null and ${t.productOrderId} is null)
        or (${t.status} in ('claimed','redeemed') and ${t.amount} >= 0 and ${t.usedAt} is not null)`,
    ),
  ],
);
