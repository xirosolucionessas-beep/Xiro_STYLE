import type { AdminAlertMessage } from './notifier';
import type { Language } from '@xiro/shared';

/**
 * Copia de los mensajes que salen por un proveedor real (Resend / Twilio). Vive aparte de `packages/shared/src/i18n.ts`
 * a propósito: ese diccionario es para lo que las apps RENDERIZAN (y exige paridad es/en estricta en cada clave para
 * los 3 clientes); esto es texto que el SERVIDOR envía por correo/SMS/WhatsApp, nunca lo ve una app.
 *
 * Solo el código de verificación (OTP) viaja con el idioma de quien lo pide (`OtpMessage.language`): los demás tipos
 * de aviso (recordatorio de cita, lista de espera, reseña) no cargan idioma en su DTO hoy — se envían en español,
 * el idioma por defecto del negocio y de la mayoría de sus clientes. Threadear el idioma del cliente hasta esos
 * mensajes es una mejora aparte (tocaría jobs/reminders.ts, booking/waitlist.ts y booking/reviewRequests.ts).
 */

export interface EmailContent {
  subject: string;
  html: string;
}

const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function otpEmail(code: string, language: Language): EmailContent {
  if (language === 'en') {
    return { subject: `${code} is your Xiro Style verification code`, html: `<p>Your verification code is <strong>${esc(code)}</strong>.</p><p>It expires soon. If you didn't request this, you can ignore this email.</p>` };
  }
  return { subject: `${code} es tu código de verificación de Xiro Style`, html: `<p>Tu código de verificación es <strong>${esc(code)}</strong>.</p><p>Vence pronto. Si no lo pediste, puedes ignorar este correo.</p>` };
}

export function otpPhone(code: string, language: Language): string {
  return language === 'en' ? `Xiro Style: your verification code is ${code}. It expires soon.` : `Xiro Style: tu código de verificación es ${code}. Vence pronto.`;
}

export function appointmentReminderEmail(clientName: string, businessName: string, when: string): EmailContent {
  return {
    subject: `Recordatorio de tu cita en ${businessName}`,
    html: `<p>Hola ${esc(clientName)},</p><p>Te esperamos en <strong>${esc(businessName)}</strong> el ${esc(when)}.</p>`,
  };
}

export function appointmentReminderPhone(clientName: string, businessName: string, when: string): string {
  return `Hola ${clientName}, te recordamos tu cita en ${businessName} el ${when}.`;
}

export function waitlistAvailableEmail(clientName: string, businessName: string, date: string, bookingPath: string): EmailContent {
  return {
    subject: `Se liberó un horario en ${businessName}`,
    html: `<p>Hola ${esc(clientName)},</p><p>Se liberó un horario el ${esc(date)} en <strong>${esc(businessName)}</strong>. Agenda aquí: ${esc(bookingPath)}</p>`,
  };
}

export function waitlistAvailablePhone(clientName: string, businessName: string, date: string, bookingPath: string): string {
  return `Hola ${clientName}, se liberó un horario el ${date} en ${businessName}. ¿Te lo agendamos? ${bookingPath}`;
}

export function reviewRequestEmail(clientName: string, businessName: string, reviewPath: string): EmailContent {
  return {
    subject: `¿Cómo te fue en ${businessName}?`,
    html: `<p>Hola ${esc(clientName)},</p><p>Gracias por tu visita a <strong>${esc(businessName)}</strong>. ¿Nos dejas una reseña? ${esc(reviewPath)}</p>`,
  };
}

export function reviewRequestPhone(clientName: string, businessName: string, reviewPath: string): string {
  return `Hola ${clientName}, gracias por tu visita a ${businessName}. ¿Nos dejas una reseña? ${reviewPath}`;
}

/** Aviso interno a XIRO (nunca al negocio ni al cliente): siempre en español, lo recibe el equipo de Xiro.
 * `event` es hoy un único valor; el switch deja listo el patrón para cuando se agreguen más. */
export function adminAlertPhone(message: AdminAlertMessage): string {
  switch (message.event) {
    case 'business_self_deleted':
      return `Xiro: ${message.requestedByName} eliminó el negocio "${message.businessName}" (${message.businessId}) el ${message.at}.`;
  }
}
