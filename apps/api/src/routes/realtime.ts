import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { AppError, parse } from '../errors';
import { consumeSseTicket } from '../sseTickets';

const ticketQuery = z.object({ ticket: z.string().min(10).max(80) });

/**
 * El stream de "algo cambió en tus citas" para la Agenda en web (SSE + LISTEN/NOTIFY, ver realtime.ts y el disparador
 * de la migración 0009). Fuera del grupo autenticado a propósito: `EventSource` no puede mandar el header
 * `Authorization`, así que la única llave es el ticket de un solo uso que emite `POST /api/booking/events/ticket`
 * (esa sí autenticada normal). El aviso nunca lleva datos de la cita, solo "vuelve a preguntar": quien escucha
 * refresca su vista de siempre, que ya filtra por sesión y por alcance.
 */
export function realtimeRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/booking/events', async (request, reply) => {
    const { ticket } = parse(ticketQuery, request.query);
    const businessId = consumeSseTicket(ticket);
    if (!businessId) throw new AppError(401, 'unauthorized');

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');

    const send = () => res.write('event: appointments\ndata: {}\n\n');
    const unsubscribe = ctx.realtime?.onBusiness(businessId, send) ?? (() => undefined);
    // Sin esto, un proxy intermedio (o el propio navegador) corta una conexión que no ve tráfico por un rato.
    const heartbeat = setInterval(() => res.write(':hb\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
