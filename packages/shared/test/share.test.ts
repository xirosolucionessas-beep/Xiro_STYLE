import { describe, expect, it } from 'vitest';
import { buildItemShareText, buildWhatsAppShareLink, formatMoney } from '../src';

const url = 'https://xiro.example/reservar/estudio-luna/articulo/11111111-1111-4111-8111-111111111111';

describe('compartir un artículo por WhatsApp (Fase 2)', () => {
  it('producto: consulta con descripción, precio en la moneda del negocio y el enlace', () => {
    const text = buildItemShareText({ name: 'Shampoo hidratante', kind: 'product', price: 15000, shortDescription: 'Para cabello seco' }, { businessName: 'Estudio Luna', publicUrl: url, currency: 'COP' });
    expect(text).toBe(
      [
        '✨ *Estudio Luna* - Consulta de Producto',
        '',
        '🛍️ *Producto:* Shampoo hidratante',
        '📝 *Descripción:* Para cabello seco',
        `💰 *Precio:* ${formatMoney(15000, 'COP')}`, // mismo formato de dinero que el resto de la app
        '',
        'Puedes ver todos los detalles aquí:',
        `🔗 ${url}`,
        '',
        '¿Deseas adquirirlo o tienes alguna duda? Escríbenos y con gusto te atendemos. 😊',
      ].join('\n'),
    );
  });

  it('producto sin descripción: "Disponible en tienda"', () => {
    expect(buildItemShareText({ name: 'Cera', kind: 'product', price: 9000 }, { businessName: 'X', publicUrl: url, currency: 'COP' })).toContain('📝 *Descripción:* Disponible en tienda');
  });

  it('servicio: reserva con duración y precio, con un ícono neutro (no asume barbería)', () => {
    const text = buildItemShareText({ name: 'Limpieza facial', kind: 'service', price: 80000, durationMinutes: 45 }, { businessName: 'Spa Sol', publicUrl: url, currency: 'COP' });
    expect(text.split('\n').slice(0, 5)).toEqual(['✨ *Spa Sol* - Reserva de Servicio', '', '📅 *Servicio:* Limpieza facial', '⏱️ *Duración estimada:* 45 min', `💰 *Precio:* ${formatMoney(80000, 'COP')}`]);
    expect(text).toContain('Consulta los detalles y agenda tu cita aquí:');
    expect(text).not.toContain('✂️');
  });

  it('servicio sin duración no inventa una; artículo sin clasificar se presenta como servicio', () => {
    const text = buildItemShareText({ name: 'Asesoría', kind: null, price: 0 }, { businessName: 'X', publicUrl: url, currency: 'COP' });
    expect(text).toContain('📅 *Servicio:* Asesoría');
    expect(text).not.toContain('Duración');
  });

  it('respeta la moneda del negocio y el idioma', () => {
    const text = buildItemShareText({ name: 'Gel', kind: 'product', price: 10, description: 'Strong hold' }, { businessName: 'Studio', publicUrl: url, currency: 'USD', language: 'en' });
    expect(text).toContain('🛍️ *Product:* Gel');
    expect(text).toMatch(/💰 \*Price:\* .*10/);
    expect(text).toContain(formatMoney(10, 'USD'));
  });

  it('el enlace de WhatsApp codifica todo el texto (saltos de línea, asteriscos, emojis)', () => {
    const link = buildWhatsAppShareLink({ name: 'A & B', kind: 'product', price: 1000 }, { businessName: 'Luna', publicUrl: url, currency: 'COP' });
    expect(link.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(link.slice('https://wa.me/?text='.length))).toContain('🛍️ *Producto:* A & B');
    expect(link).not.toMatch(/[\n ]/);
  });
});
