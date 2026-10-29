import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { CompositeNotifier, ResendNotifier, TwilioNotifier, createNotifier } from '../src/notifier';

/** Adaptadores reales de notificaciones (Resend / Twilio): valida el payload HTTP enviado a cada proveedor, el
 * reparto por canal de CompositeNotifier y las validaciones fail-closed de config.ts. Fase 1.1 de la auditoría. */

const BASE_ENV = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@db:5432/x', REDIS_URL: 'rediss://r:6379', S3_ENDPOINT: 'https://c.r2.cloudflarestorage.com', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' } as NodeJS.ProcessEnv;

describe('config.ts: NOTIFIER_PROVIDER exige (fail-closed) las credenciales de cada proveedor', () => {
  it('resend sin RESEND_API_KEY no arranca', () => {
    expect(() => loadConfig({ ...BASE_ENV, NOTIFIER_PROVIDER: 'resend' })).toThrow(/RESEND_API_KEY/);
  });

  it('twilio sin sus 4 variables no arranca, y el mensaje dice cuáles faltan', () => {
    expect(() => loadConfig({ ...BASE_ENV, NOTIFIER_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1' })).toThrow(/TWILIO_AUTH_TOKEN.*TWILIO_WHATSAPP_FROM.*TWILIO_SMS_FROM/);
  });

  it('resend completo arranca y queda disponible en config.notifications', () => {
    const config = loadConfig({ ...BASE_ENV, NOTIFIER_PROVIDER: 'resend', RESEND_API_KEY: 'key_123', NOTIFIER_FROM_EMAIL: 'avisos@xirostyle.com' });
    expect(config.notifications).toMatchObject({ provider: 'resend', resendApiKey: 'key_123', notifierFromEmail: 'avisos@xirostyle.com' });
  });

  it('resend+twilio con las dos familias completas arranca', () => {
    const config = loadConfig({
      ...BASE_ENV,
      NOTIFIER_PROVIDER: 'resend+twilio',
      RESEND_API_KEY: 'key_123',
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_WHATSAPP_FROM: '+15550001111',
      TWILIO_SMS_FROM: '+15550002222',
    });
    expect(config.notifications.provider).toBe('resend+twilio');
  });
});

describe('ResendNotifier: payload HTTP del correo', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200 })) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sendOtpEmail llama a la API de Resend con el remitente, destinatario y código configurados', async () => {
    const notifier = new ResendNotifier('re_123', 'avisos@xirostyle.com');
    await notifier.sendOtpEmail('ana@correo.com', '482913', 'es');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer re_123' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.from).toBe('avisos@xirostyle.com');
    expect(body.to).toEqual(['ana@correo.com']);
    expect(body.html).toContain('482913');
    expect(body.subject).toContain('482913');
  });

  it('el correo del OTP sale en inglés cuando el idioma de quien lo pide es "en"', async () => {
    const notifier = new ResendNotifier('re_123', 'avisos@xirostyle.com');
    await notifier.sendOtpEmail('ana@correo.com', '482913', 'en');
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.subject).toContain('verification code');
  });

  it('una respuesta de error de Resend hace fallar el envío (nunca se da por entregado)', async () => {
    global.fetch = vi.fn(async () => new Response('bad request', { status: 422 })) as unknown as typeof fetch;
    const notifier = new ResendNotifier('re_123', 'avisos@xirostyle.com');
    await expect(notifier.sendOtpEmail('ana@correo.com', '482913', 'es')).rejects.toThrow(/422/);
  });
});

describe('TwilioNotifier: payload HTTP de SMS y WhatsApp', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 })) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('canal "sms": From es el número de SMS, sin el prefijo whatsapp:', async () => {
    const notifier = new TwilioNotifier('AC1', 'tok', '+15550001111', '+15550002222');
    await notifier.sendOtpPhone('sms', '+573001234567', '482913', 'es');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Basic ${Buffer.from('AC1:tok').toString('base64')}` });
    const params = new URLSearchParams((init as RequestInit).body as string);
    expect(params.get('From')).toBe('+15550002222');
    expect(params.get('To')).toBe('+573001234567');
    expect(params.get('Body')).toContain('482913');
  });

  it('canal "whatsapp": From y To llevan el prefijo whatsapp:', async () => {
    const notifier = new TwilioNotifier('AC1', 'tok', '+15550001111', '+15550002222');
    await notifier.sendOtpPhone('whatsapp', '+573001234567', '482913', 'es');
    const params = new URLSearchParams((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(params.get('From')).toBe('whatsapp:+15550001111');
    expect(params.get('To')).toBe('whatsapp:+573001234567');
  });

  it('una respuesta de error de Twilio hace fallar el envío', async () => {
    global.fetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    const notifier = new TwilioNotifier('AC1', 'tok', '+15550001111', '+15550002222');
    await expect(notifier.sendOtpPhone('sms', '+573001234567', '482913', 'es')).rejects.toThrow(/403/);
  });
});

describe('CompositeNotifier: reparte cada mensaje a su canal, y nunca lanza si falta el proveedor de ese canal', () => {
  it('un mensaje de canal "email" va al adaptador de correo', async () => {
    const email = { sendOtpEmail: vi.fn(async () => undefined) } as unknown as ResendNotifier;
    const notifier = new CompositeNotifier(email, null, vi.fn());
    await notifier.sendOtp({ channel: 'email', to: 'ana@correo.com', code: '1', language: 'es' });
    expect(email.sendOtpEmail).toHaveBeenCalledWith('ana@correo.com', '1', 'es');
  });

  it('un mensaje de canal "whatsapp" va al adaptador de teléfono', async () => {
    const phone = { sendOtpPhone: vi.fn(async () => undefined) } as unknown as TwilioNotifier;
    const notifier = new CompositeNotifier(null, phone, vi.fn());
    await notifier.sendOtp({ channel: 'whatsapp', to: '+573001234567', code: '1', language: 'es' });
    expect(phone.sendOtpPhone).toHaveBeenCalledWith('whatsapp', '+573001234567', '1', 'es');
  });

  it('sin proveedor de correo configurado, un OTP de email no lanza: solo se registra en el log', async () => {
    const log = vi.fn();
    const notifier = new CompositeNotifier(null, null, log);
    await expect(notifier.sendOtp({ channel: 'email', to: 'ana@correo.com', code: '1', language: 'es' })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('an***@correo.com'));
  });

  it('sendAdminAlert siempre va por teléfono (nunca tiene canal propio)', async () => {
    const phone = { sendAdminAlertPhone: vi.fn(async () => undefined) } as unknown as TwilioNotifier;
    const notifier = new CompositeNotifier(null, phone, vi.fn());
    const message = { to: '+573000000000', event: 'business_self_deleted' as const, businessName: 'Studio Ana', businessId: 'biz_1', requestedByName: 'Ana', at: '2026-01-01T00:00:00Z' };
    await notifier.sendAdminAlert(message);
    expect(phone.sendAdminAlertPhone).toHaveBeenCalledWith('+573000000000', message);
  });
});

describe('createNotifier: elige el adaptador según config.notifications.provider', () => {
  it('"console" devuelve ConsoleNotifier (no llama a fetch)', async () => {
    const notifier = createNotifier({ notifications: { provider: 'console' } }, vi.fn());
    expect(notifier.constructor.name).toBe('ConsoleNotifier');
  });

  it('"resend" devuelve un CompositeNotifier con solo el canal de correo', () => {
    const notifier = createNotifier({ notifications: { provider: 'resend', resendApiKey: 'k', notifierFromEmail: 'a@b.com' } }, vi.fn());
    expect(notifier.constructor.name).toBe('CompositeNotifier');
  });
});
