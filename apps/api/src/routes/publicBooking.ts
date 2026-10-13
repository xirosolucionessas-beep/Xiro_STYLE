import {
  availabilityQuerySchema,
  discountCodeSchema,
  formatMoney,
  daysQuerySchema,
  publicBookingInputSchema,
  publicCancelInputSchema,
  publicProductOrderInputSchema,
  publicReviewInputSchema,
  publicRescheduleInputSchema,
  publicWaitlistInputSchema,
  type AvailabilityResponse,
  type Currency,
  type DaySummary,
  type PublicAppointmentDto,
  type PublicBookingCatalog,
  type PublicBookingProfile,
  type PublicBookingResult,
  type PublicReviewDto,
  type PublicTeamMemberDto,
  type PublicWaitlistDto,
} from '@xiro/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { assertClientMayChange, createAppointment, findByIdempotency, hashToken, idempotencyHash, rescheduleAppointment, submitReview, toPublicAppointment, transitionAppointment, type AppointmentRow } from '../booking/appointments';
import { loadContext, prepare, slotsForDays, toPublicSlot } from '../booking/availability';
import { verifyCaptcha } from '../booking/captcha';
import { anonymizeClient } from '../booking/privacy';
import { findUsableDiscount, redeemDiscount, toPublicDiscount } from '../booking/discounts';
import { createProductOrder, toPublicProductOrder, type ProductOrderRow } from '../booking/orders';
import { withBusiness, type Tx } from '../booking/scope';
import { allSections, loadProfileRow, loadPublicCatalog, loadPublicProfile, loadPublicReviews, loadPublicTeam, resolveSlug } from '../booking/view';
import { CLIENT_COOKIE_NAME, resolveClientAccount } from '../clientSession';
import { parseCookies } from '../cookies';
import type { Ctx } from '../context';
import { appointments, businessPublicProfiles, businesses, productOrders, waitlistEntries } from '../db/schema';
import { AppError, notFound, parse } from '../errors';
import { cancelReminder, scheduleAppointmentReminders } from '../jobs/reminders';
import { verifyReviewToken } from '../booking/reviewRequests';
import { joinWaitlist, onSlotReleased, toPublicWaitlist, waitlistByToken } from '../booking/waitlist';
import { formatPushMoment, notifyAppointment, notifyBusiness } from '../push';
import { deriveToken } from '../security';
import type { BusinessRow } from '../serializers';
import { selectionFromQuery } from './booking';

const slugParams = z.object({ slug: z.string().min(1).max(60) });
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
/** Reservas nuevas por IP y por hora: un cliente real hace una o dos; un bot, cientos. */
const CREATES_PER_IP_PER_HOUR = 20;
/** Consultas de códigos de descuento por IP y por hora (vista previa; el canje se cuenta aparte). */
const DISCOUNT_CHECKS_PER_IP_PER_HOUR = 30;
/** Anotarse en listas de espera: pocas veces por hora por IP (cada una crea un cliente y un registro). */
const WAITLIST_JOINS_PER_IP_PER_HOUR = 10;
/** Pedidos de productos nuevos por IP y por hora (mismo criterio que las reservas). */
const ORDERS_PER_IP_PER_HOUR = 20;
/** El perfil dice si el negocio está "abierto ahora": se guarda poco (lo mismo que ya lo guarda el navegador). */
const PROFILE_CACHE_SECONDS = 15;

/**
 * Página pública de reservas de un negocio (sin sesión). Reglas de esta capa:
 *  - El negocio sale SOLO de la dirección (slug) y todo id recibido se valida contra ese negocio.
 *  - Lista blanca explícita de campos: nunca clientes, notas internas, costos, existencias exactas ni datos de contacto del equipo.
 *  - La disponibilidad dice si un horario está libre, ocupado o no disponible, pero jamás quién lo ocupa.
 *  - Ninguna respuesta revela si un celular o correo ya era cliente.
 *  - Límite de peticiones por IP (global) y por negocio (todas las IP juntas); campo trampa y Turnstile (cuando hay secreto).
 */
export function publicBookingRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config } = ctx;
  const createLimiter = ctx.rates.limiter('booking-create-ip', 3_600_000);
  const orderLimiter = ctx.rates.limiter('order-create-ip', 3_600_000);
  // Probar códigos al azar: pocas consultas por IP y por hora (un cliente real escribe uno o dos).
  const discountLimiter = ctx.rates.limiter('discount-check-ip', 3_600_000);
  const waitlistLimiter = ctx.rates.limiter('waitlist-join-ip', 3_600_000);

  app.addHook('onSend', async (request, reply) => {
    const dynamic = /\/(availability|days|appointments|orders|discount|waitlist|review-link)/.test(request.url);
    // El mapa lo guarda el navegador una hora (cambia solo si mueven el pin, y para eso la URL lleva `?v=`): cada vista de la página
    // sin esto sería una consulta facturada a Google.
    if (/\/map\.png(\?|$)/.test(request.url)) return void reply.header('Cache-Control', 'public, max-age=3600');
    reply.header('Cache-Control', dynamic ? 'no-store' : 'public, max-age=15');
  });

  /** Límite por negocio: frena el abuso dirigido a la página de UN negocio aunque venga de muchas IP. */
  app.addHook('onRequest', async (request) => {
    if (!config.rateLimit.enabled) return;
    const slug = (request.params as { slug?: string } | undefined)?.slug;
    if (!slug) return;
    const used = await ctx.bookingLimiter.hit(slug);
    if (used > config.booking.publicPerMinutePerBusiness) throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await ctx.bookingLimiter.retryAfterSeconds(slug)) });
  });

  /** Negocio de la dirección, solo si su página está publicada (si no, 404 igual que si no existiera). */
  async function publishedBusiness(slug: string): Promise<BusinessRow> {
    // Caso normal (dirección vigente): negocio y "¿está publicada?" en UNA consulta (Fase 5: antes eran dos por visita).
    const [current] = await db
      .select({ business: businesses, published: businessPublicProfiles.published })
      .from(businesses)
      .leftJoin(businessPublicProfiles, eq(businessPublicProfiles.businessId, businesses.id))
      .where(eq(businesses.slug, slug))
      .limit(1);
    if (current) {
      if (!current.published) throw notFound();
      return current.business;
    }
    // Dirección anterior (el negocio cambió su slug): el camino de siempre.
    const resolved = await resolveSlug(db, slug);
    if (!resolved) throw notFound();
    const profile = await loadProfileRow(db, resolved.business.id);
    if (!profile?.published) throw notFound();
    return resolved.business;
  }

  const scopedTo = <T>(business: BusinessRow, fn: (tx: Tx) => Promise<T>) => withBusiness(db, business.id, fn);
  /**
   * Lecturas públicas guardadas en caché (ver publicCache.ts): iguales para cualquier visitante, por negocio, y se
   * invalidan en cuanto el negocio guarda un cambio. Que la página siga publicada se comprueba SIEMPRE fuera de la
   * caché (publishedBusiness), así despublicar surte efecto al instante. Disponibilidad y citas nunca se guardan.
   */
  // Se responde el JSON ya serializado: un acierto de caché se envía tal cual (mismos bytes, sin parsear y re-serializar).
  const cached = async <T>(reply: FastifyReply, business: BusinessRow, name: string, fn: (tx: Tx) => Promise<T>, ttlSeconds?: number): Promise<FastifyReply> =>
    reply.type('application/json; charset=utf-8').send(await ctx.publicCache.wrapJson(business.id, name, () => scopedTo(business, fn), ttlSeconds));

  app.get('/:slug', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    return cached(reply, business, 'profile', async (tx): Promise<PublicBookingProfile> => loadPublicProfile(tx, await loadContext(tx, business.id), new Date(), config.booking.turnstileSiteKey, ctx.maps !== null), PROFILE_CACHE_SECONDS);
  });

  /**
   * El mapa del local como imagen (Static Maps) que arma ESTE servidor: la clave de Google nunca llega al navegador y la política
   * de seguridad de /reservar no necesita abrirse a ningún script externo. Solo se dibuja lo que el negocio publicó (pin guardado y
   * sección "mapa" activa); las coordenadas salen de la base de datos, nunca de la petición.
   */
  app.get('/:slug/map.png', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    if (!ctx.maps) throw notFound();
    const profile = await scopedTo(business, (tx) => loadProfileRow(tx, business.id));
    if (!allSections(profile?.sections).map || profile?.latitude == null || profile.longitude == null) throw notFound();
    const { latitude, longitude } = profile;
    // Cada imagen nueva es una llamada facturada a Google: se guarda por negocio y coordenadas.
    const maps = ctx.maps;
    const png = await ctx.publicCache.wrap(business.id, `map:${latitude},${longitude}`, async () => (await maps.staticMap({ lat: latitude, lng: longitude }, { width: 640, height: 360 })).toString('base64'));
    return reply.type('image/png').send(Buffer.from(png, 'base64'));
  });

  app.get('/:slug/catalog', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    return cached(reply, business, 'catalog', async (tx): Promise<PublicBookingCatalog> => {
      const profile = await loadProfileRow(tx, business.id);
      return loadPublicCatalog(tx, business.id, allSections(profile?.sections));
    });
  });

  app.get('/:slug/team', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    return cached(reply, business, 'team', async (tx): Promise<PublicTeamMemberDto[]> => {
      const profile = await loadProfileRow(tx, business.id);
      const sections = allSections(profile?.sections);
      return sections.team ? loadPublicTeam(tx, business.id, sections.reviews) : [];
    });
  });

  app.get('/:slug/reviews', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    return cached(reply, business, 'reviews', async (tx): Promise<PublicReviewDto[]> => {
      const profile = await loadProfileRow(tx, business.id);
      return allSections(profile?.sections).reviews ? loadPublicReviews(tx, business.id) : [];
    });
  });

  /* ---------- Disponibilidad ---------- */

  app.get('/:slug/availability', async (request): Promise<AvailabilityResponse> => {
    const { slug } = parse(slugParams, request.params);
    const query = parse(availabilityQuerySchema, request.query);
    const business = await publishedBusiness(slug);
    return scopedTo(business, async (tx) => {
      const p = await prepare(tx, business.id, { selection: selectionFromQuery(query), professionalId: query.professionalId, staff: false });
      const [day] = await slotsForDays(tx, business.id, p, new Date(), query.date, 1);
      return { date: query.date, timezone: p.ctx.business.timezone, intervalMinutes: p.ctx.settings.slotIntervalMinutes, totalMinutes: day!.totalMinutes, slots: day!.slots.map(toPublicSlot) };
    });
  });

  app.get('/:slug/days', async (request): Promise<DaySummary[]> => {
    const { slug } = parse(slugParams, request.params);
    const query = parse(daysQuerySchema, request.query);
    const business = await publishedBusiness(slug);
    return scopedTo(business, async (tx) => {
      const p = await prepare(tx, business.id, { selection: selectionFromQuery(query), professionalId: query.professionalId, staff: false });
      const days = await slotsForDays(tx, business.id, p, new Date(), query.from, query.days);
      return days.map((d) => ({ date: d.date, open: d.open, hasAvailability: d.slots.some((s) => s.state === 'available') }));
    });
  });

  /* ---------- Reservar ---------- */

  app.post('/:slug/appointments', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const input = parse(publicBookingInputSchema, request.body);
    // Campo trampa: una persona no lo ve, un bot lo llena.
    if (input.website.trim() !== '') throw new AppError(400, 'validation_error');
    if (config.rateLimit.enabled && (await createLimiter.hit(request.ip)) > CREATES_PER_IP_PER_HOUR) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await createLimiter.retryAfterSeconds(request.ip)) });
    }
    const business = await publishedBusiness(slug);
    const idempotency = input.idempotencyKey ? { key: input.idempotencyKey, secret: config.jwtSecret } : undefined;

    // Una confirmación repetida (doble clic, reintento por mala señal) devuelve la cita que ya se creó. Se resuelve ANTES de
    // pedir el captcha: su token es de un solo uso y ya se gastó en el primer envío, así que verificarlo otra vez fallaría.
    if (idempotency) {
      const replay = await scopedTo(business, async (tx): Promise<PublicBookingResult | null> => {
        const prior = await findByIdempotency(tx, business.id, idempotencyHash(business.id, idempotency.key));
        if (!prior) return null;
        const context = await loadContext(tx, business.id);
        return { appointment: await toPublicAppointment(tx, context, business.id, prior, new Date(), await loadProfileRow(tx, business.id)), token: deriveToken(idempotency.secret, business.id, idempotency.key) };
      });
      if (replay) return reply.status(200).send(replay);
    }

    if (!(await verifyCaptcha(config.booking.turnstileSecret, input.captchaToken, request.ip))) throw new AppError(400, 'captcha_failed');

    // Si quien reserva inició sesión, la cita se asocia a SU cuenta (clientId estable), no al teléfono que haya
    // escrito en este formulario — así puede cambiar el teléfono de contacto de una cita sin perder su fidelización
    // ni su historial. Invitado: se busca o crea por teléfono, exactamente como siempre.
    const account = await resolveClientAccount(db, config.jwtSecret, parseCookies(request.headers.cookie)[CLIENT_COOKIE_NAME], business);

    let created: AppointmentRow | undefined;
    let repeated = false;
    const result = await scopedTo(business, async (tx): Promise<PublicBookingResult> => {
      const context = await loadContext(tx, business.id);
      const { customer } = input;
      // El correo siempre es opcional al agendar: solo nombre y celular son obligatorios, sin excepción por negocio.
      const custom = context.settings.customFields.map((field) => ({ field, value: (customer.custom[field.key] ?? '').trim() }));
      if (custom.some(({ field, value }) => field.required && value === '')) throw new AppError(400, 'validation_error');
      const notes = [customer.notes, ...custom.filter(({ value }) => value !== '').map(({ field, value }) => `${field.label}: ${value}`)].filter(Boolean).join('\n');

      const p = await prepare(tx, business.id, { selection: input.selection, professionalId: input.professionalId, staff: false, ctx: context });
      const now = new Date();
      const created_ = await createAppointment(tx, business.id, p, {
        now,
        startsAt: new Date(input.startsAt),
        source: 'web',
        client: account ? { id: account.clientId } : { create: { name: `${customer.firstName} ${customer.lastName}`.trim(), phone: customer.phone, email: customer.email } },
        clientAccountId: account?.id ?? null,
        customerNotes: notes,
        internalNotes: '',
        createdBy: null,
        publicFlow: true,
        termsIp: request.ip,
        remindersOptIn: input.remindersOptIn,
        ...(idempotency ? { idempotency } : {}),
      });
      const { token, replayed } = created_;
      let { row } = created_;
      // Código de descuento (Fase 4): se canjea en ESTA transacción sobre el total del servidor. Si no aplica, toda la reserva
      // se revierte con el motivo (la persona puede quitar el código y confirmar). Un reintento (replayed) ya trae el suyo.
      if (!replayed && input.discountCode) {
        if (!context.settings.discountCodesEnabled) throw new AppError(409, 'discount_invalid');
        const discount = await redeemDiscount(tx, business.id, input.discountCode, { subtotal: row.totalPrice, clientId: row.clientId, now });
        [row] = (await tx.update(appointments).set({ discountCodeId: discount.id, discountAmount: discount.amount }).where(and(eq(appointments.id, row.id), eq(appointments.businessId, business.id))).returning()) as [typeof row];
      }
      // Si otro envío idéntico ganó la carrera por unos milisegundos, esta petición devuelve SU cita y no avisa ni programa nada otra vez.
      repeated = replayed;
      if (!replayed) created = row;
      return { appointment: await toPublicAppointment(tx, context, business.id, row, now, await loadProfileRow(tx, business.id)), token: token! };
    });
    // Aviso de mejor esfuerzo al profesional asignado, fuera de la transacción (igual que el de fidelización).
    if (created) {
      const client = `${input.customer.firstName} ${input.customer.lastName}`.trim();
      void notifyAppointment({ db, config }, business.id, created.professionalId, null, 'appointments', {
        titleKey: 'push_appt_new_title',
        bodyKey: 'push_appt_new_body',
        params: { client, time: formatPushMoment(created.startsAt.toISOString(), business.timezone) },
        dedupeKey: `appt_new:${created.id}`,
        href: '/agenda',
      });
      void scheduleAppointmentReminders(ctx, business.id, created.id, created.startsAt);
    }
    return reply.status(repeated ? 200 : 201).send(result);
  });

  /* ---------- Códigos de descuento (Fase 4) ---------- */

  /**
   * Vista previa de un código para mostrar el descuento antes de confirmar. No cuenta un uso (eso pasa al confirmar) y responde
   * igual para "no existe", "vencido" o "agotado". Límite por IP: no sirve para adivinar códigos.
   */
  app.get('/:slug/discount', async (request) => {
    const { slug } = parse(slugParams, request.params);
    const { code } = parse(z.object({ code: discountCodeSchema }), request.query);
    if (config.rateLimit.enabled && (await discountLimiter.hit(request.ip)) > DISCOUNT_CHECKS_PER_IP_PER_HOUR) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await discountLimiter.retryAfterSeconds(request.ip)) });
    }
    const business = await publishedBusiness(slug);
    return scopedTo(business, async (tx) => {
      const context = await loadContext(tx, business.id);
      if (!context.settings.discountCodesEnabled) throw new AppError(409, 'discount_invalid');
      return toPublicDiscount(await findUsableDiscount(tx, business.id, code, new Date()));
    });
  });

  /* ---------- Enlace para reseñar (Fase 4) ---------- */

  /** La cita a reseñar con el enlace firmado que se envió al completarla (solo sirve para reseñar). */
  const reviewLinkParams = z.object({ slug: z.string().min(1).max(60), token: z.string().min(40).max(200) });
  app.get('/:slug/review-link/:token', async (request): Promise<PublicAppointmentDto> => {
    const { slug, token } = parse(reviewLinkParams, request.params);
    const business = await publishedBusiness(slug);
    const appointmentId = verifyReviewToken(config.jwtSecret, business.id, token);
    return scopedTo(business, (tx) => view(tx, business, appointmentId, new Date()));
  });

  app.post('/:slug/review-link/:token', async (request): Promise<PublicAppointmentDto> => {
    const { slug, token } = parse(reviewLinkParams, request.params);
    const input = parse(publicReviewInputSchema, request.body);
    const business = await publishedBusiness(slug);
    const appointmentId = verifyReviewToken(config.jwtSecret, business.id, token);
    let review: { authorName: string; rating: number; professionalId: string } | undefined;
    const dto = await scopedTo(business, async (tx) => {
      const created = await submitReview(tx, business.id, appointmentId, input);
      const [row] = await tx.select({ professionalId: appointments.professionalId }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, business.id))).limit(1);
      review = { authorName: created.authorName, rating: created.rating, professionalId: row!.professionalId };
      return view(tx, business, appointmentId, new Date());
    });
    if (review) {
      void notifyAppointment({ db, config }, business.id, review.professionalId, null, 'reviews', {
        titleKey: 'push_review_new_title',
        bodyKey: 'push_review_new_body',
        params: { author: review.authorName, rating: review.rating },
        dedupeKey: `review:${appointmentId}`,
        href: '/booking?tab=reviews',
      });
    }
    return dto;
  });

  /* ---------- Lista de espera ---------- */

  /**
   * Anotarse en la lista de un día lleno (si el negocio la activó). Mismas defensas que una reserva (campo trampa, límite por
   * IP, captcha). Devuelve el enlace personal UNA vez: con él la persona ve o quita su lugar.
   */
  app.post('/:slug/waitlist', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const input = parse(publicWaitlistInputSchema, request.body);
    if (input.website.trim() !== '') throw new AppError(400, 'validation_error');
    if (config.rateLimit.enabled && (await waitlistLimiter.hit(request.ip)) > WAITLIST_JOINS_PER_IP_PER_HOUR) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await waitlistLimiter.retryAfterSeconds(request.ip)) });
    }
    const business = await publishedBusiness(slug);
    if (!(await verifyCaptcha(config.booking.turnstileSecret, input.captchaToken, request.ip))) throw new AppError(400, 'captcha_failed');
    const name = `${input.customer.firstName} ${input.customer.lastName}`.trim();
    const result = await scopedTo(business, async (tx) => {
      const context = await loadContext(tx, business.id);
      if (!context.settings.waitlistEnabled) throw new AppError(403, 'waitlist_disabled');
      const { row, token } = await joinWaitlist(tx, business.id, context, {
        date: input.date,
        serviceIds: input.services,
        professionalId: input.professionalId,
        customer: { name, phone: input.customer.phone, email: input.customer.email || undefined },
        now: new Date(),
        termsIp: request.ip,
      });
      const profile = await loadProfileRow(tx, business.id);
      return { entry: await toPublicWaitlist(tx, business, row, profile?.displayName ?? ''), token };
    });
    return reply.status(201).send({ ...result, manageUrl: `/reservar/${business.slug}/espera/${result.token}` });
  });

  app.get('/:slug/waitlist/:token', async (request): Promise<PublicWaitlistDto> => {
    const { slug, token } = parse(tokenParams, request.params);
    const business = await publishedBusiness(slug);
    return scopedTo(business, async (tx) => toPublicWaitlist(tx, business, await waitlistByToken(tx, business.id, token), (await loadProfileRow(tx, business.id))?.displayName ?? ''));
  });

  app.post('/:slug/waitlist/:token/cancel', async (request): Promise<PublicWaitlistDto> => {
    const { slug, token } = parse(tokenParams, request.params);
    const business = await publishedBusiness(slug);
    return scopedTo(business, async (tx) => {
      const current = await waitlistByToken(tx, business.id, token);
      const [row] = current.status === 'cancelled' ? [current] : await tx.update(waitlistEntries).set({ status: 'cancelled' }).where(and(eq(waitlistEntries.id, current.id), eq(waitlistEntries.businessId, business.id))).returning();
      return toPublicWaitlist(tx, business, row!, (await loadProfileRow(tx, business.id))?.displayName ?? '');
    });
  });

  /* ---------- Pedir productos sin cita ---------- */

  /**
   * Pedido de SOLO productos (recoger y pagar en el local), si el negocio lo activó. Mismas defensas que una reserva: campo
   * trampa, límite por IP y por negocio, captcha e idempotencia. Precios, total y existencias los decide el servidor.
   */
  app.post('/:slug/orders', async (request, reply) => {
    const { slug } = parse(slugParams, request.params);
    const input = parse(publicProductOrderInputSchema, request.body);
    if (input.website.trim() !== '') throw new AppError(400, 'validation_error');
    if (config.rateLimit.enabled && (await orderLimiter.hit(request.ip)) > ORDERS_PER_IP_PER_HOUR) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(await orderLimiter.retryAfterSeconds(request.ip)) });
    }
    const business = await publishedBusiness(slug);
    const now = new Date();

    // Un reintento del MISMO envío devuelve el pedido ya creado, antes de pedir otra vez el captcha (de un solo uso).
    if (input.idempotencyKey) {
      const key = input.idempotencyKey;
      const replay = await scopedTo(business, async (tx) => {
        const prior = await tx.select().from(productOrders).where(and(eq(productOrders.businessId, business.id), eq(productOrders.idempotencyHash, idempotencyHash(business.id, `order:${key}`)))).limit(1);
        return prior[0] ? toPublicProductOrder(tx, business, prior[0], await loadProfileRow(tx, business.id)) : null;
      });
      if (replay) return reply.status(200).send({ order: replay });
    }

    if (!(await verifyCaptcha(config.booking.turnstileSecret, input.captchaToken, request.ip))) throw new AppError(400, 'captcha_failed');
    const account = await resolveClientAccount(db, config.jwtSecret, parseCookies(request.headers.cookie)[CLIENT_COOKIE_NAME], business);
    const name = `${input.customer.firstName} ${input.customer.lastName}`.trim();

    let created: ProductOrderRow | undefined;
    const order = await scopedTo(business, async (tx) => {
      const context = await loadContext(tx, business.id);
      const profile = await loadProfileRow(tx, business.id);
      // El negocio no los activó (o ocultó sus productos): igual que una ruta inexistente para quien pregunta.
      if (!context.settings.productOrdersEnabled || !allSections(profile?.sections).products) throw new AppError(403, 'orders_disabled');
      const result = await createProductOrder(tx, business.id, context, {
        now,
        lines: input.products,
        customer: { name, phone: input.customer.phone, email: input.customer.email, notes: input.customer.notes },
        account: account ? { id: account.id, clientId: account.clientId } : null,
        termsIp: request.ip,
        idempotencyKey: input.idempotencyKey,
        discountCode: input.discountCode,
      });
      if (!result.replayed) created = result.row;
      return toPublicProductOrder(tx, business, result.row, profile);
    });

    // Aviso de mejor esfuerzo al negocio (y a NINGÚN otro), fuera de la transacción. El panel web además se refresca solo
    // por el aviso en tiempo real del trigger de `product_orders`.
    if (created) {
      void notifyBusiness({ db, config }, business.id, 'sales', {
        titleKey: 'push_order_new_title',
        bodyKey: 'push_order_new_body',
        params: { name, amount: formatMoney(created.totalPrice, business.currency as Currency) },
        dedupeKey: `order_new:${created.id}`,
        href: '/orders',
      });
    }
    return reply.status(created ? 201 : 200).send({ order });
  });

  /* ---------- Gestión de la cita con el enlace personal ---------- */

  /**
   * El token (256 bits aleatorios; en la base solo su hash) es la única llave. Se busca sin negocio activo porque aún no se
   * sabe de cuál es, y luego se EXIGE que pertenezca al negocio de la dirección: un token de otro negocio responde 404.
   */
  async function ownAppointment(slug: string, token: string): Promise<{ business: BusinessRow; appointmentId: string }> {
    if (!TOKEN.test(token)) throw notFound();
    const resolved = await resolveSlug(db, slug);
    if (!resolved) throw notFound();
    const [row] = await db.select({ id: appointments.id, businessId: appointments.businessId, expiresAt: appointments.tokenExpiresAt }).from(appointments).where(eq(appointments.tokenHash, hashToken(token))).limit(1);
    if (!row || row.businessId !== resolved.business.id || !row.expiresAt || row.expiresAt.getTime() < Date.now()) throw notFound();
    return { business: resolved.business, appointmentId: row.id };
  }

  const view = async (tx: Tx, business: BusinessRow, appointmentId: string, now: Date): Promise<PublicAppointmentDto> => {
    const context = await loadContext(tx, business.id);
    const [row] = await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, business.id))).limit(1);
    if (!row) throw notFound();
    return toPublicAppointment(tx, context, business.id, row, now, await loadProfileRow(tx, business.id));
  };

  const tokenParams = z.object({ slug: z.string().min(1).max(60), token: z.string().min(1).max(200) });

  app.get('/:slug/appointments/:token', async (request): Promise<PublicAppointmentDto> => {
    const { slug, token } = parse(tokenParams, request.params);
    const { business, appointmentId } = await ownAppointment(slug, token);
    return scopedTo(business, (tx) => view(tx, business, appointmentId, new Date()));
  });

  app.post('/:slug/appointments/:token/cancel', async (request): Promise<PublicAppointmentDto> => {
    const { slug, token } = parse(tokenParams, request.params);
    const { reason } = parse(publicCancelInputSchema, request.body ?? {});
    const { business, appointmentId } = await ownAppointment(slug, token);
    let cancelled: AppointmentRow | undefined;
    const dto = await scopedTo(business, async (tx) => {
      const now = new Date();
      const context = await loadContext(tx, business.id);
      cancelled = await transitionAppointment(tx, business.id, appointmentId, 'cancelled', reason, { kind: 'client' }, now, undefined, (row: AppointmentRow) => assertClientMayChange(context, row, now, 'cancel'));
      return view(tx, business, appointmentId, now);
    });
    if (cancelled) {
      void notifyAppointment({ db, config }, business.id, cancelled.professionalId, null, 'appointments', {
        titleKey: 'push_appt_cancelled_title',
        bodyKey: 'push_appt_cancelled_body',
        params: { time: formatPushMoment(cancelled.startsAt.toISOString(), business.timezone) },
        dedupeKey: `appt_cancel:${appointmentId}`,
        href: '/agenda',
      });
      void cancelReminder(ctx.boss, appointmentId);
      void onSlotReleased(ctx, business.id, cancelled.startsAt, business.timezone);
    }
    return dto;
  });

  /**
   * Derecho de supresión (Ley 1581): el cliente borra sus propios datos identificables con el mismo enlace de gestión que
   * usa para cancelar o mover la cita (es la única prueba de identidad que existe hoy, sin correo/SMS de verificación).
   * La cita permanece como registro contable; solo se quita lo que identifica a la persona. Ver booking/privacy.ts.
   */
  app.post('/:slug/appointments/:token/privacy-delete', async (request): Promise<{ ok: true }> => {
    const { slug, token } = parse(tokenParams, request.params);
    const { business, appointmentId } = await ownAppointment(slug, token);
    return scopedTo(business, async (tx) => {
      const [row] = await tx.select({ clientId: appointments.clientId }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, business.id))).limit(1);
      if (!row) throw notFound();
      await anonymizeClient(tx, business.id, row.clientId);
      return { ok: true };
    });
  });

  /** Reseñar la propia cita ya completada, con el mismo enlace de gestión. Queda "por revisar" hasta que el negocio la modere. */
  app.post('/:slug/appointments/:token/review', async (request): Promise<PublicAppointmentDto> => {
    const { slug, token } = parse(tokenParams, request.params);
    const input = parse(publicReviewInputSchema, request.body);
    const { business, appointmentId } = await ownAppointment(slug, token);
    let review: { authorName: string; rating: number; professionalId: string } | undefined;
    const dto = await scopedTo(business, async (tx) => {
      const created = await submitReview(tx, business.id, appointmentId, input);
      const [row] = await tx.select({ professionalId: appointments.professionalId }).from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.businessId, business.id))).limit(1);
      review = { authorName: created.authorName, rating: created.rating, professionalId: row!.professionalId };
      return view(tx, business, appointmentId, new Date());
    });
    if (review) {
      void notifyAppointment({ db, config }, business.id, review.professionalId, null, 'reviews', {
        titleKey: 'push_review_new_title',
        bodyKey: 'push_review_new_body',
        params: { author: review.authorName, rating: review.rating },
        dedupeKey: `review:${appointmentId}`,
        href: '/booking?tab=reviews',
      });
    }
    return dto;
  });

  app.post('/:slug/appointments/:token/reschedule', async (request): Promise<PublicAppointmentDto> => {
    const { slug, token } = parse(tokenParams, request.params);
    const input = parse(publicRescheduleInputSchema, request.body);
    const { business, appointmentId } = await ownAppointment(slug, token);
    let moved: AppointmentRow | undefined;
    let previousStart: Date | undefined;
    const dto = await scopedTo(business, async (tx) => {
      const now = new Date();
      const context = await loadContext(tx, business.id);
      moved = await rescheduleAppointment(tx, business.id, context, appointmentId, {
        now,
        startsAt: new Date(input.startsAt),
        professionalId: input.professionalId,
        actor: { kind: 'client' },
        clientInitiated: true,
        guard: (row) => {
          assertClientMayChange(context, row, now, 'reschedule');
          previousStart = row.startsAt;
        },
      });
      return view(tx, business, appointmentId, now);
    });
    if (moved) {
      void notifyAppointment({ db, config }, business.id, moved.professionalId, null, 'appointments', {
        titleKey: 'push_appt_rescheduled_title',
        bodyKey: 'push_appt_rescheduled_body',
        params: { time: formatPushMoment(moved.startsAt.toISOString(), business.timezone) },
        dedupeKey: `appt_reschedule:${appointmentId}:${moved.startsAt.toISOString()}`,
        href: '/agenda',
      });
      void scheduleAppointmentReminders(ctx, business.id, appointmentId, moved.startsAt);
      if (previousStart && previousStart.getTime() !== moved.startsAt.getTime()) void onSlotReleased(ctx, business.id, previousStart, business.timezone);
    }
    return dto;
  });
}
