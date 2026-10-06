import { describe, expect, it } from 'vitest';
import { buildReportsPdf, reportsPdfFileName, type ReportsPdfInput } from '../src/web/services/reportsPdf';

function baseInput(over: Partial<ReportsPdfInput> = {}): ReportsPdfInput {
  return {
    businessName: 'Peluquería Ana',
    businessAddress: 'Calle 10 #5-20, Bogotá, Colombia',
    businessPhone: '3001234567',
    logoDataUrl: null,
    periodLabel: '21 – 27 sept 2026',
    generatedAtLabel: 'domingo, 4 de octubre de 2026 · 3:15 p. m.',
    kpis: [
      { label: 'Ventas', value: '$ 650.000' },
      { label: 'Servicios', value: '12' },
      { label: 'Ticket promedio', value: '$ 54.166' },
      { label: 'Clientes nuevos', value: '3' },
    ],
    growth: { percentLabel: '+18%', statusText: 'Crecimiento respecto al periodo anterior', currentLabel: '$ 650.000', previousLabel: '$ 550.000' },
    cashBalance: { openingLabel: '$ 25.000', cashSalesLabel: '$ 400.000', totalLabel: '$ 425.000' },
    paymentMethods: [
      { label: 'Efectivo', amountLabel: '$ 400.000', percent: 62 },
      { label: 'Nequi', amountLabel: '$ 250.000', percent: 38 },
    ],
    employees: [{ name: 'Carlos Ruiz', countLabel: '8 veces', amountLabel: '$ 500.000', percent: 77 }],
    topServices: [{ name: 'Corte', countLabel: '6 veces', amountLabel: '$ 180.000' }],
    topProducts: [{ name: 'Shampoo', countLabel: '2 veces', amountLabel: '$ 40.000' }],
    dailyRows: [
      { dateLabel: 'lun 21 sept', countLabel: 'Servicios: 2', amountLabel: 'Ventas: $ 100.000' },
      { dateLabel: 'mar 22 sept', countLabel: 'Servicios: 0', amountLabel: 'Ventas: $ 0' },
    ],
    ...over,
  };
}

describe('buildReportsPdf', () => {
  it('genera el documento con todas las secciones, sin lanzar excepciones', () => {
    const doc = buildReportsPdf(baseInput());
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('sin crecimiento (sin periodo anterior) sigue generando el documento', () => {
    const doc = buildReportsPdf(baseInput({ growth: null }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('sin ninguna sección opcional (formas de pago, empleados, más vendidos, detalle) no rompe', () => {
    const doc = buildReportsPdf(baseInput({ paymentMethods: [], employees: [], topServices: [], topProducts: [], dailyRows: [] }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('sin base de caja registrada en el periodo (ningún día se abrió), omite esa sección sin romper', () => {
    const doc = buildReportsPdf(baseInput({ cashBalance: null }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('un logo inválido no rompe la generación (se omite)', () => {
    const doc = buildReportsPdf(baseInput({ logoDataUrl: 'data:image/png;base64,not-a-real-image' }));
    expect(doc.output('datauristring')).toContain('data:application/pdf');
  });

  it('un detalle diario largo pagina correctamente (más de una hoja)', () => {
    const dailyRows = Array.from({ length: 80 }, (_, i) => ({ dateLabel: `día ${i + 1}`, countLabel: `Servicios: ${i}`, amountLabel: `Ventas: $ ${i * 1000}` }));
    const doc = buildReportsPdf(baseInput({ dailyRows }));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});

describe('reportsPdfFileName', () => {
  it('arma un nombre de archivo a partir del periodo, sin caracteres raros', () => {
    expect(reportsPdfFileName('21 – 27 sept 2026')).toMatch(/^reporte-.*\.pdf$/);
  });
});
