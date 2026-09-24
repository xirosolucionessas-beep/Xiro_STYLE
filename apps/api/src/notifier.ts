import type { Language, RecoveryChannel } from '@xiro/shared';

export interface OtpMessage {
  channel: RecoveryChannel;
  /** Correo (canal email) o número internacional (sms / whatsapp). */
  to: string;
  code: string;
  language: Language;
}

/**
 * Punto de integración con el proveedor real (Twilio, WhatsApp Cloud API, Resend, etc.).
 * Sin proveedor configurado se usa ConsoleNotifier, que solo imprime el código en el log del servidor.
 */
export interface Notifier {
  sendOtp(message: OtpMessage): Promise<void>;
}

export class ConsoleNotifier implements Notifier {
  constructor(private readonly log: (line: string) => void = console.log) {}

  async sendOtp(message: OtpMessage): Promise<void> {
    this.log(`[otp] canal=${message.channel} destino=${message.to} código=${message.code}`);
  }
}
