import { randomBytes } from 'node:crypto';

interface Ticket {
  businessId: string;
  expiresAt: number;
}

const TTL_MS = 30_000;
const tickets = new Map<string, Ticket>();

function sweepExpired(now: number): void {
  for (const [key, value] of tickets) if (value.expiresAt < now) tickets.delete(key);
}

/**
 * El navegador nativo `EventSource` no puede mandar el header `Authorization`, así que el stream de eventos (ver
 * routes/realtime.ts) no puede exigir el JWT normal. En su lugar, la ruta autenticada de siempre emite este ticket:
 * aleatorio, de un solo uso y vence en 30 segundos — nunca el access token real llega a viajar en una URL.
 */
export function issueSseTicket(businessId: string): string {
  sweepExpired(Date.now());
  const ticket = randomBytes(24).toString('base64url');
  tickets.set(ticket, { businessId, expiresAt: Date.now() + TTL_MS });
  return ticket;
}

/** Lo consume exista o no (nunca se puede reutilizar), y solo devuelve el negocio si seguía vigente. */
export function consumeSseTicket(ticket: string): string | null {
  const found = tickets.get(ticket);
  tickets.delete(ticket);
  if (!found || found.expiresAt < Date.now()) return null;
  return found.businessId;
}
