import { describe, expect, it } from 'vitest';
import { buildReportsWorkbook, reportsExcelFileName, type ReportsExcelInput } from '../src/web/services/reportsExcel';

function baseInput(over: Partial<ReportsExcelInput> = {}): ReportsExcelInput {
  return {
    periodLabel: '21 – 27 sept 2026',
    currency: 'COP',
    kpis: { sales: 650_000, services: 12, average: 54_166, growthPercent: 18, openingBase: 25_000, cashTotal: 425_000 },
    dailyRows: [
      { date: '2026-09-21', count: 2, total: 100_000, average: 50_000 },
      { date: '2026-09-22', count: 0, total: 0, average: 0 },
    ],
    topServices: [{ label: 'Corte', count: 6, total: 180_000 }],
    topProducts: [{ label: 'Shampoo', count: 2, total: 40_000 }],
    employees: [{ employeeId: 'e1', employeeName: 'Carlos Ruiz', count: 8, total: 500_000, percent: 77 }],
    paymentMethods: [
      { method: 'cash', total: 400_000, count: 5, percent: 62 },
      { method: 'nequi', total: 250_000, count: 3, percent: 38 },
    ],
    ...over,
  };
}

describe('buildReportsWorkbook', () => {
  it('genera las 6 hojas con encabezados y datos, sin lanzar excepciones', () => {
    const workbook = buildReportsWorkbook(baseInput());
    const names = workbook.worksheets.map((sheet) => sheet.name);
    expect(names).toEqual(['Resumen de KPIs', 'Ventas por día', 'Servicios más solicitados', 'Productos más vendidos', 'Rendimiento de empleados', 'Formas de pago']);
    const daily = workbook.getWorksheet('Ventas por día')!;
    expect(daily.getRow(2).getCell('date').value).toBe('2026-09-21');
    expect(daily.getRow(2).getCell('total').value).toBe(100_000);
  });

  it('sin crecimiento ni base de caja (nada registrado) sigue generando el libro', () => {
    const workbook = buildReportsWorkbook(baseInput({ kpis: { sales: 0, services: 0, average: null, growthPercent: null, openingBase: null, cashTotal: null } }));
    expect(workbook.worksheets).toHaveLength(6);
  });

  it('incluye la base inicial y el total en caja en la hoja de resumen', () => {
    const workbook = buildReportsWorkbook(baseInput());
    const summary = workbook.getWorksheet('Resumen de KPIs')!;
    const openingRow = [...Array(summary.rowCount).keys()].map((i) => summary.getRow(i + 1)).find((row) => String(row.getCell('label').value).includes('Base inicial'));
    const cashTotalRow = [...Array(summary.rowCount).keys()].map((i) => summary.getRow(i + 1)).find((row) => String(row.getCell('label').value).includes('Total en caja'));
    expect(openingRow?.getCell('value').value).toBe(25_000);
    expect(cashTotalRow?.getCell('value').value).toBe(425_000);
  });

  it('sin empleados ni formas de pago (ninguna venta con esos datos) deja esas hojas solo con encabezado', () => {
    const workbook = buildReportsWorkbook(baseInput({ employees: [], paymentMethods: [] }));
    const employees = workbook.getWorksheet('Rendimiento de empleados')!;
    expect(employees.rowCount).toBe(1); // solo el encabezado
  });

  it('calcula la participación porcentual de cada servicio sobre el total de la hoja', () => {
    const workbook = buildReportsWorkbook(baseInput({ topServices: [{ label: 'Corte', count: 3, total: 60_000 }, { label: 'Tinte', count: 1, total: 40_000 }] }));
    const sheet = workbook.getWorksheet('Servicios más solicitados')!;
    expect(sheet.getRow(2).getCell('percent').value).toBe(60);
    expect(sheet.getRow(3).getCell('percent').value).toBe(40);
  });

  it('un método de pago desconocido se muestra tal cual (sin romper)', () => {
    const workbook = buildReportsWorkbook(baseInput({ paymentMethods: [{ method: 'crypto', total: 10_000, count: 1, percent: 100 }] }));
    const sheet = workbook.getWorksheet('Formas de pago')!;
    expect(sheet.getRow(2).getCell('method').value).toBe('crypto');
  });
});

describe('reportsExcelFileName', () => {
  it('arma un nombre de archivo a partir del periodo, sin caracteres raros', () => {
    expect(reportsExcelFileName('21 – 27 sept 2026')).toMatch(/^reporte-.*\.xlsx$/);
  });
});
