import ExcelJS from 'exceljs';
import type { Currency } from '@xiro/shared';
import type { EmployeePerformanceRow, PaymentMethodRow, RankRow } from '@/lib/sections';

/**
 * Exportación del reporte a Excel (sección 1.5): un libro con 5 hojas (resumen, ventas por día, más vendidos,
 * empleados, formas de pago), con encabezados y formatos numéricos/monetarios reales — no texto ya formateado —
 * para que se pueda sumar/analizar directamente en la hoja de cálculo. Se genera enteramente en el navegador
 * (ExcelJS), igual que los PDF: nada pasa por el servidor.
 */

export interface ReportsExcelKpis {
  sales: number;
  services: number;
  average: number | null;
  /** `null` sin base de comparación. */
  growthPercent: number | null;
  /** Suma de las bases de caja del periodo; `null` si ningún día se abrió. */
  openingBase: number | null;
  /** Base inicial + ventas en efectivo; `null` si `openingBase` es null. */
  cashTotal: number | null;
}

export interface ReportsExcelDailyRow {
  /** "2026-09-24" o "2026-09" (mes) según la granularidad del periodo. */
  date: string;
  count: number;
  total: number;
  average: number;
}

export interface ReportsExcelInput {
  periodLabel: string;
  currency: Currency;
  kpis: ReportsExcelKpis;
  dailyRows: ReportsExcelDailyRow[];
  topServices: RankRow[];
  topProducts: RankRow[];
  employees: EmployeePerformanceRow[];
  paymentMethods: PaymentMethodRow[];
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB08D3E' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const MONEY_FORMAT = '#,##0';
const PERCENT_FORMAT = '0"%"';

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  row.commit();
}

const PAYMENT_METHOD_LABEL: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', nequi: 'Nequi', bank_transfer: 'Transferencia', other: 'Otro' };

/** Construye el libro (sin descargarlo): separado de `downloadReportsExcel` para poder probarlo. */
export function buildReportsWorkbook(input: ReportsExcelInput): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'XIRO STYLE';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('Resumen de KPIs');
  summary.columns = [
    { header: 'Indicador', key: 'label', width: 28 },
    { header: 'Valor', key: 'value', width: 20 },
  ];
  styleHeaderRow(summary.getRow(1));
  summary.addRow({ label: 'Periodo', value: input.periodLabel });
  summary.addRow({ label: `Ventas (${input.currency})`, value: input.kpis.sales }).getCell('value').numFmt = MONEY_FORMAT;
  summary.addRow({ label: 'Servicios', value: input.kpis.services });
  const avgRow = summary.addRow({ label: `Ticket promedio (${input.currency})`, value: input.kpis.average ?? 0 });
  if (input.kpis.average !== null) avgRow.getCell('value').numFmt = MONEY_FORMAT;
  const growthRow = summary.addRow({ label: 'Crecimiento vs. periodo anterior', value: input.kpis.growthPercent ?? 'Sin datos del periodo anterior' });
  if (input.kpis.growthPercent !== null) growthRow.getCell('value').numFmt = PERCENT_FORMAT;
  const openingRow = summary.addRow({ label: `Base inicial de caja (${input.currency})`, value: input.kpis.openingBase ?? 0 });
  openingRow.getCell('value').numFmt = MONEY_FORMAT;
  const cashTotalRow = summary.addRow({ label: `Total en caja (${input.currency})`, value: input.kpis.cashTotal ?? 0 });
  cashTotalRow.getCell('value').numFmt = MONEY_FORMAT;

  const daily = workbook.addWorksheet('Ventas por día');
  daily.columns = [
    { header: 'Fecha', key: 'date', width: 14 },
    { header: 'N.° de servicios', key: 'count', width: 16 },
    { header: `Ventas (${input.currency})`, key: 'total', width: 18 },
    { header: `Ticket promedio (${input.currency})`, key: 'average', width: 20 },
  ];
  styleHeaderRow(daily.getRow(1));
  for (const row of input.dailyRows) {
    const added = daily.addRow(row);
    added.getCell('total').numFmt = MONEY_FORMAT;
    added.getCell('average').numFmt = MONEY_FORMAT;
  }

  const topSheet = workbook.addWorksheet('Servicios más solicitados');
  topSheet.columns = [
    { header: 'Servicio', key: 'label', width: 32 },
    { header: 'Cantidad', key: 'count', width: 12 },
    { header: `Ingresos (${input.currency})`, key: 'total', width: 18 },
    { header: 'Participación', key: 'percent', width: 14 },
  ];
  styleHeaderRow(topSheet.getRow(1));
  const serviceTotal = input.topServices.reduce((sum, row) => sum + row.total, 0);
  for (const row of input.topServices) {
    const added = topSheet.addRow({ label: row.label, count: row.count, total: row.total, percent: serviceTotal > 0 ? Math.round((row.total / serviceTotal) * 100) : 0 });
    added.getCell('total').numFmt = MONEY_FORMAT;
    added.getCell('percent').numFmt = PERCENT_FORMAT;
  }

  const productSheet = workbook.addWorksheet('Productos más vendidos');
  productSheet.columns = [
    { header: 'Producto', key: 'label', width: 32 },
    { header: 'Cantidad', key: 'count', width: 12 },
    { header: `Ingresos (${input.currency})`, key: 'total', width: 18 },
    { header: 'Participación', key: 'percent', width: 14 },
  ];
  styleHeaderRow(productSheet.getRow(1));
  const productTotal = input.topProducts.reduce((sum, row) => sum + row.total, 0);
  for (const row of input.topProducts) {
    const added = productSheet.addRow({ label: row.label, count: row.count, total: row.total, percent: productTotal > 0 ? Math.round((row.total / productTotal) * 100) : 0 });
    added.getCell('total').numFmt = MONEY_FORMAT;
    added.getCell('percent').numFmt = PERCENT_FORMAT;
  }

  const employees = workbook.addWorksheet('Rendimiento de empleados');
  employees.columns = [
    { header: 'Empleado', key: 'employeeName', width: 28 },
    { header: 'Servicios atendidos', key: 'count', width: 18 },
    { header: `Ingresos generados (${input.currency})`, key: 'total', width: 22 },
    { header: 'Participación', key: 'percent', width: 14 },
  ];
  styleHeaderRow(employees.getRow(1));
  for (const row of input.employees) {
    const added = employees.addRow(row);
    added.getCell('total').numFmt = MONEY_FORMAT;
    added.getCell('percent').numFmt = PERCENT_FORMAT;
  }

  const methods = workbook.addWorksheet('Formas de pago');
  methods.columns = [
    { header: 'Método', key: 'method', width: 20 },
    { header: 'Cantidad de transacciones', key: 'count', width: 22 },
    { header: `Valor total (${input.currency})`, key: 'total', width: 18 },
    { header: 'Porcentaje', key: 'percent', width: 14 },
  ];
  styleHeaderRow(methods.getRow(1));
  for (const row of input.paymentMethods) {
    const added = methods.addRow({ method: PAYMENT_METHOD_LABEL[row.method] ?? row.method, count: row.count, total: row.total, percent: row.percent });
    added.getCell('total').numFmt = MONEY_FORMAT;
    added.getCell('percent').numFmt = PERCENT_FORMAT;
  }

  return workbook;
}

/** Nombre de archivo estable a partir del periodo. */
export function reportsExcelFileName(periodLabel: string): string {
  return `reporte-${periodLabel.replace(/[^\w.-]+/g, '-').toLowerCase()}.xlsx`;
}

/** Genera el libro y dispara la descarga del navegador (sin pasar por el servidor). */
export async function downloadReportsExcel(input: ReportsExcelInput): Promise<void> {
  const workbook = buildReportsWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = reportsExcelFileName(input.periodLabel);
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
