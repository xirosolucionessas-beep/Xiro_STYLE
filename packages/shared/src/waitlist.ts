import { z } from 'zod';
import { isoDateSchema, publicCustomerSchema } from './booking';

const uuidString = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'not_found');

/**
 * Lista de espera (Fase 4): un día lleno → la persona deja sus datos; cuando se libera un horario ese día, se le avisa.
 * Estados: waiting (esperando) → notified (se le avisó que hay horario) | cancelled (la quitó la persona o el negocio).
 */
export const WAITLIST_STATUSES = ['waiting', 'notified', 'cancelled'] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const publicWaitlistInputSchema = z.object({
  date: isoDateSchema,
  services: z.array(uuidString).min(1).max(10),
  professionalId: z.union([z.literal('any'), uuidString]).default('any'),
  customer: publicCustomerSchema,
  acceptTerms: z.literal(true, { error: 'terms_required' }),
  website: z.string().max(200).default(''),
  captchaToken: z.string().max(4096).optional(),
});
export type PublicWaitlistInput = z.input<typeof publicWaitlistInputSchema>;

/** Lo que ve la persona de SU lugar en la lista (con su enlace personal). */
export interface PublicWaitlistDto {
  date: string;
  status: WaitlistStatus;
  services: string[];
  business: { name: string; slug: string };
}

/** Lo que ve el negocio. */
export interface WaitlistEntryDto {
  id: string;
  date: string;
  status: WaitlistStatus;
  clientId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  services: Array<{ id: string; name: string }>;
  professionalId: string | null;
  notifiedAt: string | null;
  createdAt: string;
}

export const waitlistQuerySchema = z.object({
  /** Desde esta fecha local (incluida); por defecto, hoy. */
  from: isoDateSchema.optional(),
  status: z.enum(WAITLIST_STATUSES).optional(),
});
