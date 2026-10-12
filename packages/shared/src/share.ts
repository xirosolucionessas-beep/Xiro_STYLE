import { formatMoney, type Currency } from './money';

/**
 * Mensaje para compartir UN artículo del catálogo por WhatsApp (Fase 2 del plan). Distingue producto y servicio, y todo sale del
 * negocio: nombre, moneda y la dirección pública del artículo. Solo el precio final: nunca costos internos ni existencias.
 * Íconos neutros (sirve para cualquier tipo de negocio, no solo barberías).
 */
export interface ShareableItem {
  name: string;
  /** 'product' = producto; cualquier otro valor (servicio o sin clasificar) se presenta como servicio. */
  kind: string | null;
  price: number;
  shortDescription?: string | null;
  description?: string | null;
  durationMinutes?: number | null;
}

export function buildItemShareText(item: ShareableItem, options: { businessName: string; publicUrl: string; currency: Currency | string; language?: 'es' | 'en' }): string {
  const price = formatMoney(item.price, options.currency as Currency);
  const description = (item.shortDescription || item.description || '').trim();
  const en = options.language === 'en';
  if (item.kind === 'product') {
    return [
      `✨ *${options.businessName}* - ${en ? 'Product inquiry' : 'Consulta de Producto'}`,
      '',
      `🛍️ *${en ? 'Product' : 'Producto'}:* ${item.name}`,
      `📝 *${en ? 'Description' : 'Descripción'}:* ${description || (en ? 'Available in store' : 'Disponible en tienda')}`,
      `💰 *${en ? 'Price' : 'Precio'}:* ${price}`,
      '',
      en ? 'See all the details here:' : 'Puedes ver todos los detalles aquí:',
      `🔗 ${options.publicUrl}`,
      '',
      en ? 'Would you like to get it, or do you have any questions? Write to us and we will gladly help. 😊' : '¿Deseas adquirirlo o tienes alguna duda? Escríbenos y con gusto te atendemos. 😊',
    ].join('\n');
  }
  return [
    `✨ *${options.businessName}* - ${en ? 'Service booking' : 'Reserva de Servicio'}`,
    '',
    `📅 *${en ? 'Service' : 'Servicio'}:* ${item.name}`,
    ...(item.durationMinutes ? [`⏱️ *${en ? 'Estimated duration' : 'Duración estimada'}:* ${item.durationMinutes} min`] : []),
    `💰 *${en ? 'Price' : 'Precio'}:* ${price}`,
    '',
    en ? 'See the details and book your appointment here:' : 'Consulta los detalles y agenda tu cita aquí:',
    `🔗 ${options.publicUrl}`,
    '',
    en ? 'Would you like to book your spot? Reply to this message and we will gladly help. ✨' : '¿Te gustaría agendar tu espacio? Responde a este mensaje y con gusto te ayudamos. ✨',
  ].join('\n');
}

/** Enlace de WhatsApp sin destinatario fijo (la persona elige a quién enviarlo). Con un número, usar `whatsappLink`. */
export function buildWhatsAppShareLink(item: ShareableItem, options: Parameters<typeof buildItemShareText>[1]): string {
  return `https://wa.me/?text=${encodeURIComponent(buildItemShareText(item, options))}`;
}
