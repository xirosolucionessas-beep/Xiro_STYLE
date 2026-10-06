import type { PgBoss } from 'pg-boss';
import type { GoogleMaps } from './booking/google';
import type { Config } from './config';
import type { Database } from './db/client';
import type { Notifier } from './notifier';
import type { RealtimeBus } from './realtime';
import type { WindowCounter } from './security';

export interface Ctx {
  db: Database;
  config: Config;
  notifier: Notifier;
  /** Frena la fuerza bruta por cuenta (login, OTP) aunque cambie la IP. */
  accountLimiter: WindowCounter;
  /** Límite por negocio de la página pública de reservas (todas las IP juntas). */
  bookingLimiter: WindowCounter;
  /** Cola de trabajos (recordatorios de citas). `null` en pruebas y en cualquier arranque que no la inicie: programar
   * o cancelar un recordatorio sin cola es entonces un no-op silencioso, nunca un error para quien reserva. */
  boss: PgBoss | null;
  /** LISTEN/NOTIFY para la Agenda en tiempo real (ver routes/realtime.ts). `null` en pruebas: sin bus no hay avisos,
   * pero la API sigue funcionando exactamente igual (el cliente web cae de nuevo a refrescar por su cuenta). */
  realtime: RealtimeBus | null;
  /** Google Maps Platform (Places, Geocoding, Static Maps) — ver booking/google.ts. `null` sin clave configurada. */
  maps: GoogleMaps | null;
}
