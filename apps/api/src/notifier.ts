import type { Language, RecoveryChannel } from '@xiro/shared';

export interface OtpMessage {
  channel: RecoveryChannel;
  /** Correo (canal email) o número internacional (sms / whatsapp). */
  to: string;
  code: string;
  language: Language;
}

export interface AppointmentReminderMessage {
  /** 'whatsapp' si el cliente dejó celular, si no 'email'; sin ninguno de los dos no se programa el recordatorio. */
  channel: 'whatsapp' | 'email';
  to: string;
  clientName: string;
  businessName: string;
  /** Fecha/hora ya formateada en la zona horaria del negocio (el proveedor real la incrusta tal cual en la plantilla). */
  when: string;
}

/**
 * Punto de integración con el proveedor real (Twilio, WhatsApp Cloud API, Resend, etc.).
 * Sin proveedor configurado se usa ConsoleNotifier, que solo imprime el código en el log del servidor.
 */
export interface Notifier {
  sendOtp(message: OtpMessage): Promise<void>;
  /** Recordatorio de cita al CLIENTE (el push al profesional va por push.ts, no por aquí). Pendiente de credenciales
   * reales (Resend / WhatsApp Cloud API); ver apps/api/src/jobs/reminders.ts. */
  sendAppointmentReminder(message: AppointmentReminderMessage): Promise<void>;
  /** Fase 4: se liberó un horario el día que alguien esperaba (opcional: un proveedor que aún no lo implementa simplemente no avisa). */
  sendWaitlistAvailable?(message: WaitlistAvailableMessage): Promise<void>;
  /** Fase 4: pedir una reseña después de una cita completada. */
  sendReviewRequest?(message: ReviewRequestMessage): Promise<void>;
}

export interface WaitlistAvailableMessage {
  channel: 'whatsapp' | 'email';
  to: string;
  clientName: string;
  businessName: string;
  /** Fecha local "AAAA-MM-DD". */
  date: string;
  /** Ruta de la página de reservas del negocio (el proveedor la convierte en enlace completo con su dominio). */
  bookingPath: string;
}

export interface ReviewRequestMessage {
  channel: 'whatsapp' | 'email';
  to: string;
  clientName: string;
  businessName: string;
  /** Enlace de gestión de la cita (ahí está el formulario de reseña). */
  reviewPath: string;
}

/**
 * Solo desarrollo (la configuración impide usarlo en producción): escribe el mensaje en el log para poder probar los
 * flujos sin proveedor. Enmascara el destino (correo/teléfono) para no llenar los logs de datos personales.
 */
export class ConsoleNotifier implements Notifier {
  constructor(private readonly log: (line: string) => void = console.log) {}

  async sendOtp(message: OtpMessage): Promise<void> {
    this.log(`[otp] (solo desarrollo) canal=${message.channel} destino=${maskDestination(message.to)} código=${message.code}`);
  }

  async sendAppointmentReminder(message: AppointmentReminderMessage): Promise<void> {
    this.log(`[recordatorio] (solo desarrollo) canal=${message.channel} destino=${maskDestination(message.to)} negocio=${message.businessName} cita=${message.when}`);
  }

  async sendWaitlistAvailable(message: WaitlistAvailableMessage): Promise<void> {
    this.log(`[lista de espera] (solo desarrollo) canal=${message.channel} destino=${maskDestination(message.to)} negocio=${message.businessName} día=${message.date}`);
  }

  async sendReviewRequest(message: ReviewRequestMessage): Promise<void> {
    this.log(`[reseña] (solo desarrollo) canal=${message.channel} destino=${maskDestination(message.to)} negocio=${message.businessName}`);
  }
}

/** "ana@correo.com" → "an***@correo.com"; "573001234567" → "57******4567". */
export function maskDestination(to: string): string {
  const at = to.indexOf('@');
  if (at > 0) return `${to.slice(0, Math.min(2, at))}***${to.slice(at)}`;
  return to.length > 6 ? `${to.slice(0, 2)}${'*'.repeat(to.length - 6)}${to.slice(-4)}` : '***';
}

/** Elige el notificador según la configuración (hoy solo existe `console`, válido únicamente en desarrollo). */
export function createNotifier(config: { notifications: { provider: 'console' } }, log: (line: string) => void): Notifier {
  switch (config.notifications.provider) {
    case 'console':
      return new ConsoleNotifier(log);
  }
}
