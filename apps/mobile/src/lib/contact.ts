/**
 * Datos oficiales de contacto de Xiro — ÚNICA fuente para Web y nativo.
 * Soporte de Xiro ≠ "enviar al cliente por WhatsApp" (esa acción abre el WhatsApp del CLIENTE, ver `phone.ts` de @xiro/shared).
 * No repitas estos datos escritos a mano: importa de aquí (test/contact.web.test.ts lo vigila).
 */
export const XIRO_CONTACT = {
  /** Como se muestra al usuario. */
  whatsappDisplay: '+57 301 3059562',
  /** Solo dígitos, con código de país (formato de wa.me). */
  whatsappDigits: '573013059562',
  email: 'xirosoluciones.sas@gmail.com',
} as const;

/** Enlace a la conversación de soporte de Xiro, con un mensaje opcional prellenado. */
export function supportWhatsappUrl(message?: string): string {
  const base = `https://wa.me/${XIRO_CONTACT.whatsappDigits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** Enlace de correo a soporte, con asunto opcional. */
export function supportMailtoUrl(subject?: string, body?: string): string {
  const base = `mailto:${XIRO_CONTACT.email}`;
  const query = [subject ? `subject=${encodeURIComponent(subject)}` : '', body ? `body=${encodeURIComponent(body)}` : ''].filter(Boolean).join('&');
  return query ? `${base}?${query}` : base;
}

/** Mensaje de soporte prellenado; incluye el negocio si se conoce. */
export function supportMessage(language: 'es' | 'en', businessName?: string | null): string {
  if (language === 'en') return businessName ? `Hi Xiro, I need help with my Xiro Style account (${businessName}).` : 'Hi Xiro, I need help with my Xiro Style account.';
  return businessName ? `Hola Xiro, necesito ayuda con mi cuenta de Xiro Style (${businessName}).` : 'Hola Xiro, necesito ayuda con mi cuenta de Xiro Style.';
}
