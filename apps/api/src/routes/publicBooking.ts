import {
  availabilityQuerySchema,
  daysQuerySchema,
  publicBookingInputSchema,
  publicCancelInputSchema,
  publicReviewInputSchema,
  publicRescheduleInputSchema,
  type AvailabilityResponse,
  type DaySummary,
  type PublicAppointmentDto,
  type PublicBookingCatalog,
  type PublicBookingProfile,
  type PublicBookingResult,
  type PublicReviewDto,
  type PublicTeamMemberDto,
} from '@xiro/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertClientMayChange, createAppointment, findByIdempotency, hashToken, idempotencyHash, rescheduleAppointment, submitReview, toPublicAppointment, transitionAppointment, type AppointmentRow } from '../booking/appointments';
import { loadContext, prepare, slotsForDays, toPublicSlot } from '../booking/availability';
import { verifyCaptcha } from '../booking/captcha';
import { anonymizeClient } from '../booking/privacy';
import { withBusiness, type Tx } from '../booking/scope';
import { allSections, loadProfileRow, loadPublicCatalog, loadPublicProfile, loadPublicReviews, loadPublicTeam, resolveSlug } from '../booking/view';
import { CLIENT_COOKIE_NAME, resolveClientAccount } from '../clientSession';
import { parseCookies } from '../cookies';
import type { Ctx } from '../context';
import { appointments } from '../db/schema';
import { AppError, notFound, parse } from '../errors';
import { cancelReminder, scheduleReminder } from '../jobs/reminders';
import { formatPushMoment, notifyAppointment } from '../push';
import { deriveToken, WindowCounter } from '../security';
import type { BusinessRow } from '../serializers';
import { selectionFromQuery } from './booking';

const slugParams = z.object({ slug: z.string().min(1).max(60) });
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
/** Reservas nuevas por IP y por hora: un cliente real hace una o dos; un bot, cientos. */
const CREATES_PER_IP_PER_HOUR = 20;

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
  const createLimiter = new WindowCounter(3_600_000);

  app.addHook('onSend', async (request, reply) => {
    const dynamic = /\/(availability|days|appointments)/.test(request.url);
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
    const used = ctx.bookingLimiter.hit(slug);
    if (used > config.booking.publicPerMinutePerBusiness) throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(ctx.bookingLimiter.retryAfterSeconds(slug)) });
  });

  /** Negocio de la dirección, solo si su página está publicada (si no, 404 igual que si no existiera). */
  async function publishedBusiness(slug: string): Promise<BusinessRow> {
    const resolved = await resolveSlug(db, slug);
    if (!resolved) throw notFound();
    const profile = await loadProfileRow(db, resolved.business.id);
    if (!profile?.published) throw notFound();
    return resolved.business;
  }

  const scopedTo = <T>(business: BusinessRow, fn: (tx: Tx) => Promise<T>) => withBusiness(db, business.id, fn);

  app.get('/:slug', async (request): Promise<PublicBookingProfile> => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    return scopedTo(business, async (tx) => loadPublicProfile(tx, await loadContext(tx, business.id), new Date(), config.booking.turnstileSiteKey, ctx.maps !== null));
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
    const png = await ctx.maps.staticMap({ lat: profile.latitude, lng: profile.longitude }, { width: 640, height: 360 });
    return reply.type('image/png').send(png);
  });

  app.get('/:slug/catalog', async (request): Promise<PublicBookingCatalog> => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    return scopedTo(business, async (tx) => {
      const profile = await loadProfileRow(tx, business.id);
      return loadPublicCatalog(tx, business.id, allSections(profile?.sections));
    });
  });

  app.get('/:slug/team', async (request): Promise<PublicTeamMemberDto[]> => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    return scopedTo(business, async (tx) => {
      const profile = await loadProfileRow(tx, business.id);
      return allSections(profile?.sections).team ? loadPublicTeam(tx, business.id) : [];
    });
  });

  app.get('/:slug/reviews', async (request): Promise<PublicReviewDto[]> => {
    const { slug } = parse(slugParams, request.params);
    const business = await publishedBusiness(slug);
    return scopedTo(business, async (tx) => {
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
    if (config.rateLimit.enabled && createLimiter.hit(request.ip) > CREATES_PER_IP_PER_HOUR) {
      throw new AppError(429, 'too_many_requests', undefined, { 'Retry-After': String(createLimiter.retryAfterSeconds(request.ip)) });
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
      const { row, token, replayed } = await createAppointment(tx, business.id, p, {
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
      void scheduleReminder(ctx.boss, business.id, created.id, created.startsAt);
    }
    return reply.status(repeated ? 200 : 201).send(result);
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
    const dto = await scopedTo(business, async (tx) => {
      const now = new Date();
      const context = await loadContext(tx, business.id);
      moved = await rescheduleAppointment(tx, business.id, context, appointmentId, {
        now,
        startsAt: new Date(input.startsAt),
        professionalId: input.professionalId,
        actor: { kind: 'client' },
        clientInitiated: true,
        guard: (row) => assertClientMayChange(context, row, now, 'reschedule'),
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
      void scheduleReminder(ctx.boss, business.id, appointmentId, moved.startsAt);
    }
    return dto;
  });
}
