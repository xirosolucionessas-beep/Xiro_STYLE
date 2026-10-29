import type { Language, RecoveryChannel } from '@xiro/shared';
import { adminAlertPhone, appointmentReminderEmail, appointmentReminderPhone, otpEmail, otpPhone, reviewRequestEmail, reviewRequestPhone, waitlistAvailableEmail, waitlistAvailablePhone } from './notifierTemplates';

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
 * Punto de integración con el proveedor real (Resend para correo, Twilio para sms/whatsapp — ver ResendNotifier,
 * TwilioNotifier y CompositeNotifier más abajo). Sin proveedor configurado (NOTIFIER_PROVIDER=console, solo
 * desarrollo) se usa ConsoleNotifier, que solo imprime el código en el log del servidor.
 */
export interface Notifier {
  sendOtp(message: OtpMessage): Promise<void>;
  /** Recordatorio de cita al CLIENTE (el push al profesional va por push.ts, no por aquí). Ver apps/api/src/jobs/reminders.ts. */
  sendAppointmentReminder(message: AppointmentReminderMessage): Promise<void>;
  /** Fase 4: se liberó un horario el día que alguien esperaba (opcional: un notificador que no lo implemente simplemente no avisa). */
  sendWaitlistAvailable?(message: WaitlistAvailableMessage): Promise<void>;
  /** Fase 4: pedir una reseña después de una cita completada. */
  sendReviewRequest?(message: ReviewRequestMessage): Promise<void>;
  /** Aviso a XIRO (no al negocio) por un evento operativo, p. ej. un dueño eliminó su cuenta (ver accountDeletion.ts).
   * Siempre por teléfono (ver CompositeNotifier.sendAdminAlert); opcional para que un notificador que no lo implemente
   * no rompa nada. El registro de auditoría (platform_audit_log) NUNCA depende de que este aviso se entregue. */
  sendAdminAlert?(message: AdminAlertMessage): Promise<void>;
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

export interface AdminAlertMessage {
  /** Número fijo de XIRO, nunca el de un negocio (ver accountDeletion.ts). */
  to: string;
  event: 'business_self_deleted';
  businessName: string;
  businessId: string;
  requestedByName: string;
  /** Instante ya formateado (igual criterio que el resto de mensajes al cliente: el proveedor real lo incrusta tal cual). */
  at: string;
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

  async sendAdminAlert(message: AdminAlertMessage): Promise<void> {
    this.log(`[aviso a xiro] (solo desarrollo) destino=${maskDestination(message.to)} evento=${message.event} negocio=${message.businessName} (${message.businessId})`);
  }
}

/** "ana@correo.com" → "an***@correo.com"; "573001234567" → "57******4567". */
export function maskDestination(to: string): string {
  const at = to.indexOf('@');
  if (at > 0) return `${to.slice(0, Math.min(2, at))}***${to.slice(at)}`;
  return to.length > 6 ? `${to.slice(0, 2)}${'*'.repeat(to.length - 6)}${to.slice(-4)}` : '***';
}

const RESEND_URL = 'https://api.resend.com/emails';
/** Tope por envío (correo, SMS o WhatsApp): uno colgado no debe bloquear para siempre la petición que lo disparó. */
const SEND_TIMEOUT_MS = 10_000;

/** Corta la espera a `ms`: un correo o mensaje colgado no debe bloquear para siempre la petición que lo disparó. */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Adaptador de correo (Resend): un fetch directo a su API HTTP (igual estilo que src/paypal.ts), sin SDK — la
 * superficie que necesitamos es un solo endpoint. 10 s de tope por envío.
 */
export class ResendNotifier {
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
  ) {}

  private async send(to: string, subject: string, html: string): Promise<void> {
    const res = await fetchWithTimeout(
      RESEND_URL,
      { method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: this.fromEmail, to: [to], subject, html }) },
      SEND_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`Resend respondió ${res.status}: ${await res.text()}`);
  }

  async sendOtpEmail(to: string, code: string, language: Language): Promise<void> {
    const t = otpEmail(code, language);
    await this.send(to, t.subject, t.html);
  }
  async sendAppointmentReminderEmail(to: string, clientName: string, businessName: string, when: string): Promise<void> {
    const t = appointmentReminderEmail(clientName, businessName, when);
    await this.send(to, t.subject, t.html);
  }
  async sendWaitlistAvailableEmail(to: string, clientName: string, businessName: string, date: string, bookingPath: string): Promise<void> {
    const t = waitlistAvailableEmail(clientName, businessName, date, bookingPath);
    await this.send(to, t.subject, t.html);
  }
  async sendReviewRequestEmail(to: string, clientName: string, businessName: string, reviewPath: string): Promise<void> {
    const t = reviewRequestEmail(clientName, businessName, reviewPath);
    await this.send(to, t.subject, t.html);
  }
}

/**
 * Adaptador de SMS y WhatsApp (Twilio): una sola cuenta cubre los DOS canales de teléfono de `RECOVERY_CHANNELS`
 * ('sms' y 'whatsapp'); la API de WhatsApp Cloud de Meta por sí sola solo cubriría 'whatsapp'.
 */
export class TwilioNotifier {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly whatsappFrom: string,
    private readonly smsFrom: string,
  ) {}

  private async send(channel: 'sms' | 'whatsapp', to: string, body: string): Promise<void> {
    const from = channel === 'whatsapp' ? `whatsapp:${this.whatsappFrom}` : this.smsFrom;
    const toAddr = channel === 'whatsapp' ? `whatsapp:${to}` : to;
    const res = await fetchWithTimeout(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: from, To: toAddr, Body: body }).toString(),
      },
      SEND_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`Twilio respondió ${res.status}: ${await res.text()}`);
  }

  async sendOtpPhone(channel: 'sms' | 'whatsapp', to: string, code: string, language: Language): Promise<void> {
    await this.send(channel, to, otpPhone(code, language));
  }
  async sendAppointmentReminderPhone(to: string, clientName: string, businessName: string, when: string): Promise<void> {
    await this.send('whatsapp', to, appointmentReminderPhone(clientName, businessName, when));
  }
  async sendWaitlistAvailablePhone(to: string, clientName: string, businessName: string, date: string, bookingPath: string): Promise<void> {
    await this.send('whatsapp', to, waitlistAvailablePhone(clientName, businessName, date, bookingPath));
  }
  async sendReviewRequestPhone(to: string, clientName: string, businessName: string, reviewPath: string): Promise<void> {
    await this.send('whatsapp', to, reviewRequestPhone(clientName, businessName, reviewPath));
  }
  async sendAdminAlertPhone(to: string, message: AdminAlertMessage): Promise<void> {
    await this.send('whatsapp', to, adminAlertPhone(message));
  }
}

/**
 * Reparte cada mensaje a su adaptador según el canal. Si el canal pedido no tiene proveedor configurado (p. ej.
 * `NOTIFIER_PROVIDER=resend` sin Twilio y alguien pide 'sms'), se registra en el log y no se envía — igual criterio
 * que los métodos opcionales de `Notifier`: nunca lanza ni interrumpe el flujo que lo disparó.
 */
export class CompositeNotifier implements Notifier {
  constructor(
    private readonly email: ResendNotifier | null,
    private readonly phone: TwilioNotifier | null,
    private readonly log: (line: string) => void,
  ) {}

  private noProvider(kind: string, to: string): void {
    this.log(`[${kind}] sin proveedor configurado para ese canal, no se envió a ${maskDestination(to)}`);
  }

  async sendOtp(message: OtpMessage): Promise<void> {
    if (message.channel === 'email') {
      if (!this.email) return this.noProvider('otp', message.to);
      return this.email.sendOtpEmail(message.to, message.code, message.language);
    }
    if (!this.phone) return this.noProvider('otp', message.to);
    return this.phone.sendOtpPhone(message.channel, message.to, message.code, message.language);
  }

  async sendAppointmentReminder(message: AppointmentReminderMessage): Promise<void> {
    if (message.channel === 'email') {
      if (!this.email) return this.noProvider('recordatorio', message.to);
      return this.email.sendAppointmentReminderEmail(message.to, message.clientName, message.businessName, message.when);
    }
    if (!this.phone) return this.noProvider('recordatorio', message.to);
    return this.phone.sendAppointmentReminderPhone(message.to, message.clientName, message.businessName, message.when);
  }

  async sendWaitlistAvailable(message: WaitlistAvailableMessage): Promise<void> {
    if (message.channel === 'email') {
      if (!this.email) return this.noProvider('lista de espera', message.to);
      return this.email.sendWaitlistAvailableEmail(message.to, message.clientName, message.businessName, message.date, message.bookingPath);
    }
    if (!this.phone) return this.noProvider('lista de espera', message.to);
    return this.phone.sendWaitlistAvailablePhone(message.to, message.clientName, message.businessName, message.date, message.bookingPath);
  }

  async sendReviewRequest(message: ReviewRequestMessage): Promise<void> {
    if (message.channel === 'email') {
      if (!this.email) return this.noProvider('reseña', message.to);
      return this.email.sendReviewRequestEmail(message.to, message.clientName, message.businessName, message.reviewPath);
    }
    if (!this.phone) return this.noProvider('reseña', message.to);
    return this.phone.sendReviewRequestPhone(message.to, message.clientName, message.businessName, message.reviewPath);
  }

  async sendAdminAlert(message: AdminAlertMessage): Promise<void> {
    if (!this.phone) return this.noProvider('aviso a xiro', message.to);
    return this.phone.sendAdminAlertPhone(message.to, message);
  }
}

/** Elige el notificador según la configuración: `console` solo en desarrollo; con un proveedor real configurado,
 * reparte cada mensaje a su canal (ver `CompositeNotifier`). */
export function createNotifier(
  config: {
    notifications:
      | { provider: 'console' }
      | { provider: 'resend'; resendApiKey: string; notifierFromEmail: string }
      | { provider: 'twilio'; twilioAccountSid: string; twilioAuthToken: string; twilioWhatsappFrom: string; twilioSmsFrom: string }
      | {
          provider: 'resend+twilio';
          resendApiKey: string;
          notifierFromEmail: string;
          twilioAccountSid: string;
          twilioAuthToken: string;
          twilioWhatsappFrom: string;
          twilioSmsFrom: string;
        };
  },
  log: (line: string) => void,
): Notifier {
  const n = config.notifications;
  switch (n.provider) {
    case 'console':
      return new ConsoleNotifier(log);
    case 'resend':
      return new CompositeNotifier(new ResendNotifier(n.resendApiKey, n.notifierFromEmail), null, log);
    case 'twilio':
      return new CompositeNotifier(null, new TwilioNotifier(n.twilioAccountSid, n.twilioAuthToken, n.twilioWhatsappFrom, n.twilioSmsFrom), log);
    case 'resend+twilio':
      return new CompositeNotifier(new ResendNotifier(n.resendApiKey, n.notifierFromEmail), new TwilioNotifier(n.twilioAccountSid, n.twilioAuthToken, n.twilioWhatsappFrom, n.twilioSmsFrom), log);
  }
}
