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
}

export class ConsoleNotifier implements Notifier {
  constructor(private readonly log: (line: string) => void = console.log) {}

  async sendOtp(message: OtpMessage): Promise<void> {
    this.log(`[otp] canal=${message.channel} destino=${message.to} código=${message.code}`);
  }

  async sendAppointmentReminder(message: AppointmentReminderMessage): Promise<void> {
    this.log(`[recordatorio] canal=${message.channel} destino=${message.to} cliente=${message.clientName} negocio=${message.businessName} cita=${message.when}`);
  }
}
