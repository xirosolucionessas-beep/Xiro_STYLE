import { describe, expect, it } from 'vitest';
import { ticketHtml } from '../src/web/services/print';

/** Impresión del recibo/cierre: un documento propio de ticket vertical (no la pantalla de la app, que salía en blanco). */
describe('ticket de impresión', () => {
  const html = ticketHtml({
    title: 'Comprobante A1',
    header: ['Luna <script>alert(1)</script>', ''],
    meta: [{ label: 'Cliente', value: 'Ana & "Bea"' }],
    lines: [{ name: 'Corte', detail: '2 × $10.000', amount: '$20.000' }],
    totals: [{ label: 'Total', value: '$20.000', strong: true }],
    footer: '¡Gracias!',
  });

  it('es un documento completo con su CSS de impresión de ticket (80 mm)', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('@page { size: 80mm auto');
    expect(html).toContain('<title>Comprobante A1</title>');
  });

  it('incluye todos los datos y escapa lo que viene del negocio o del cliente (sin inyectar HTML)', () => {
    expect(html).toContain('Luna &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Ana &amp; &quot;Bea&quot;');
    expect(html).toContain('2 × $10.000');
    expect(html).toContain('class="row kv strong"');
    expect(html).toContain('¡Gracias!');
  });
});
