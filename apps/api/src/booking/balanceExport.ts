import { formatMoney, translate, type BalanceDto, type BalanceMovementDto, type Currency, type ExpenseDto, type Language } from '@xiro/shared';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { balanceMovements, computeBalance } from './balance';
import type { Tx } from './scope';
import { localDate } from './time';

/**
 * Descargas del Balance general (PDF y Excel) y de la lista de Gastos (Excel), generadas en el servidor. Usan EXACTAMENTE
 * las mismas consultas que la pantalla (`computeBalance` y `balanceMovements`): los totales del archivo no pueden diferir de
 * los que se ven. Montos en pesos enteros; fechas en días locales del negocio.
 */

/** Tope de movimientos por archivo (12 meses de un negocio pequeño caben de sobra; si no, se avisa en el archivo). */
export const EXPORT_MAX_MOVEMENTS = 5000;

export interface ExportBusiness {
  name: string;
  address: string;
  city: string;
  currency: Currency;
  timezone: string;
}

export interface BalanceExportData {
  business: ExportBusiness;
  balance: BalanceDto;
  movements: BalanceMovementDto[];
  /** Movimientos del periodo en total (si pasa de EXPORT_MAX_MOVEMENTS, el archivo lo dice). */
  movementsTotal: number;
  generatedAt: Date;
}

export async function loadBalanceExport(tx: Tx, businessId: string, business: ExportBusiness, from: string, to: string): Promise<BalanceExportData> {
  const balance = await computeBalance(tx, businessId, from, to, business.timezone);
  const page = await balanceMovements(tx, businessId, { from, to, kind: 'all', sort: 'date', dir: 'asc', page: 1, pageSize: EXPORT_MAX_MOVEMENTS }, business.timezone);
  return { business, balance, movements: page.rows, movementsTotal: page.total, generatedAt: new Date() };
}

/* ---------- Textos comunes ---------- */

const texts = (lang: Language) => (key: string, params?: Record<string, string | number>) => translate(lang, key, params);

function dayLabel(day: string, lang: Language): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/** "13 oct" (sin año: el periodo completo ya está en el encabezado). */
function shortDay(day: string, lang: Language): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`))
    .replace(/\./g, '')
    .replace(/ de /g, ' ');
}

function rangeLabel(from: string, to: string, lang: Language): string {
  return from === to ? dayLabel(from, lang) : `${dayLabel(from, lang)} – ${dayLabel(to, lang)}`;
}

function generatedLabel(date: Date, timezone: string, lang: Language): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: timezone }).format(date);
}

function changeLabel(value: number | null, t: ReturnType<typeof texts>, lang: Language): string {
  if (value === null) return t('bal_no_prev');
  return `${value > 0 ? '+' : ''}${percentLabel(value, lang)}`;
}

function movementKind(m: BalanceMovementDto, t: ReturnType<typeof texts>): string {
  return t(`bal_kind_${m.kind}`);
}

function movementCategory(m: BalanceMovementDto, t: ReturnType<typeof texts>): string {
  return m.category ? t(`exp_cat_${m.category}`) : '';
}

/** Resta como negativo, pero un cero sigue siendo cero (si no, el archivo muestra "-$ 0"). */
const neg = (value: number) => (value === 0 ? 0 : -value);

/** Porcentaje con el separador decimal del idioma ("53,8 %" en español). */
export function percentLabel(value: number, lang: Language): string {
  return `${new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-CO', { maximumFractionDigits: 1 }).format(value)} %`;
}

/** Filas del resumen: concepto, valor del periodo, valor del periodo anterior y variación. Las mismas en PDF y Excel. */
function summaryRows(balance: BalanceDto, t: ReturnType<typeof texts>, lang: Language): Array<{ label: string; value: number; previous: number; change: string; strong?: boolean }> {
  const { totals: c, previous, comparison } = balance;
  const p = previous.totals;
  return [
    { label: t('bal_x_services'), value: c.services, previous: p.services, change: '' },
    { label: t('bal_x_products'), value: c.products, previous: p.products, change: '' },
    { label: t('bal_x_discounts'), value: neg(c.discounts), previous: neg(p.discounts), change: '' },
    { label: t('bal_income'), value: c.income, previous: p.income, change: changeLabel(comparison.income, t, lang), strong: true },
    { label: t('bal_operating'), value: neg(c.operating), previous: neg(p.operating), change: changeLabel(comparison.operating, t, lang) },
    { label: t('bal_payroll'), value: neg(c.payroll), previous: neg(p.payroll), change: changeLabel(comparison.payroll, t, lang) },
    { label: t('bal_net'), value: c.net, previous: p.net, change: changeLabel(comparison.net, t, lang), strong: true },
  ];
}

/* ---------- Excel ---------- */

const MONEY_FMT = '#,##0;[Red]-#,##0';

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8A6A35' } };
  row.alignment = { vertical: 'middle' };
}

/** Fecha local "AAAA-MM-DD" como celda de fecha real de Excel (medianoche UTC: Excel no guarda zona horaria). */
const excelDate = (day: string) => new Date(`${day}T00:00:00Z`);

export async function buildBalanceXlsx(data: BalanceExportData, lang: Language): Promise<Buffer> {
  const t = texts(lang);
  const { balance, business } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'XIRO';
  wb.created = data.generatedAt;

  // Resumen
  const summary = wb.addWorksheet(t('bal_x_sheet_summary'));
  summary.columns = [{ width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }];
  summary.addRow([business.name]).font = { bold: true, size: 14 };
  summary.addRow([t('bal_title')]).font = { bold: true, size: 12 };
  summary.addRow([`${t('bal_period')}: ${rangeLabel(balance.from, balance.to, lang)}`]);
  summary.addRow([`${t('bal_x_previous')}: ${rangeLabel(balance.previous.from, balance.previous.to, lang)}`]);
  summary.addRow([t('bal_x_generated', { date: generatedLabel(data.generatedAt, business.timezone, lang) })]).font = { italic: true, color: { argb: 'FF777777' } };
  summary.addRow([]);
  styleHeader(summary.addRow([t('bal_x_concept'), t('bal_period'), t('bal_x_previous'), t('bal_x_change')]));
  for (const r of summaryRows(balance, t, lang)) {
    const row = summary.addRow([r.label, r.value, r.previous, r.change]);
    if (r.strong) row.font = { bold: true };
  }
  const marginRow = summary.addRow([t('bal_x_margin'), balance.totals.margin === null ? t('bal_no_margin') : balance.totals.margin / 100, balance.previous.totals.margin === null ? '' : balance.previous.totals.margin / 100]);
  summary.addRow([t('bal_x_tips'), balance.totals.tips, balance.previous.totals.tips]);
  summary.getColumn(2).numFmt = MONEY_FMT;
  summary.getColumn(3).numFmt = MONEY_FMT;
  // El margen va en porcentaje (después del formato de moneda de la columna, que lo pisaría).
  marginRow.getCell(2).numFmt = '0.0%';
  marginRow.getCell(3).numFmt = '0.0%';

  // Por periodo (lo mismo que los gráficos)
  const periods = wb.addWorksheet(t('bal_x_sheet_periods'));
  periods.columns = [{ width: 14 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 18 }];
  styleHeader(periods.addRow([t('bal_from'), t('bal_to'), t('bal_income'), t('bal_chart_expenses'), t('bal_net')]));
  for (const b of balance.series.buckets) periods.addRow([excelDate(b.from), excelDate(b.to), b.income, b.expenses, b.net]);
  const periodTotal = periods.addRow([t('bal_x_total'), '', balance.totals.income, balance.totals.operating + balance.totals.payroll, balance.totals.net]);
  periodTotal.font = { bold: true };
  periods.getColumn(1).numFmt = 'yyyy-mm-dd';
  periods.getColumn(2).numFmt = 'yyyy-mm-dd';
  for (const col of [3, 4, 5]) periods.getColumn(col).numFmt = MONEY_FMT;
  periods.views = [{ state: 'frozen', ySplit: 1 }];

  // Gastos por categoría (la dona)
  const categories = wb.addWorksheet(t('bal_x_sheet_categories'));
  categories.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 14 }];
  styleHeader(categories.addRow([t('bal_x_category'), t('bal_x_type'), t('bal_x_amount'), t('bal_x_share')]));
  const spent = balance.expenseBreakdown.reduce((sum, s) => sum + s.amount, 0);
  for (const s of balance.expenseBreakdown) categories.addRow([t(`exp_cat_${s.category}`), t(`exp_type_${s.type}`), s.amount, spent > 0 ? s.amount / spent : 0]);
  categories.addRow([t('bal_x_total'), '', spent, spent > 0 ? 1 : 0]).font = { bold: true };
  categories.getColumn(3).numFmt = MONEY_FMT;
  categories.getColumn(4).numFmt = '0.0%';

  // Movimientos
  const moves = wb.addWorksheet(t('bal_x_sheet_movements'));
  moves.columns = [{ width: 12 }, { width: 18 }, { width: 22 }, { width: 44 }, { width: 16 }, { width: 16 }];
  styleHeader(moves.addRow([t('bal_x_date'), t('bal_x_type'), t('bal_x_category'), t('bal_x_description'), t('bal_x_in'), t('bal_x_out')]));
  for (const m of data.movements) {
    const day = localDate(new Date(m.at), business.timezone);
    moves.addRow([excelDate(day), movementKind(m, t), movementCategory(m, t), m.description, m.direction === 'in' ? m.amount : null, m.direction === 'out' ? m.amount : null]);
  }
  const totalIn = data.movements.filter((m) => m.direction === 'in').reduce((sum, m) => sum + m.amount, 0);
  const totalOut = data.movements.filter((m) => m.direction === 'out').reduce((sum, m) => sum + m.amount, 0);
  moves.addRow([t('bal_x_total'), '', '', '', totalIn, totalOut]).font = { bold: true };
  if (data.movementsTotal > data.movements.length) moves.addRow([t('bal_x_truncated', { count: data.movements.length })]).font = { italic: true };
  moves.getColumn(1).numFmt = 'yyyy-mm-dd';
  moves.getColumn(5).numFmt = MONEY_FMT;
  moves.getColumn(6).numFmt = MONEY_FMT;
  moves.views = [{ state: 'frozen', ySplit: 1 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildExpensesXlsx(rows: ExpenseDto[], business: ExportBusiness, range: { from: string; to: string }, lang: Language): Promise<Buffer> {
  const t = texts(lang);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'XIRO';
  const sheet = wb.addWorksheet(t('exp_x_title'));
  sheet.columns = [{ width: 12 }, { width: 14 }, { width: 22 }, { width: 40 }, { width: 22 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 22 }, { width: 30 }];
  sheet.addRow([`${business.name} · ${t('exp_x_title')} · ${rangeLabel(range.from, range.to, lang)}`]).font = { bold: true, size: 13 };
  sheet.addRow([]);
  styleHeader(
    sheet.addRow([
      t('bal_x_date'),
      t('bal_x_type'),
      t('bal_x_category'),
      t('bal_x_description'),
      t('exp_x_employee'),
      t('exp_x_method'),
      t('exp_x_from_cash'),
      t('exp_x_status'),
      t('bal_x_amount'),
      t('exp_x_recorded_by'),
      t('exp_x_void_reason'),
    ]),
  );
  for (const e of rows) {
    sheet.addRow([
      excelDate(e.expenseDate),
      t(`exp_type_${e.type}`),
      t(`exp_cat_${e.category}`),
      e.description,
      e.employeeName ?? '',
      t(`sale_pay_${e.method}`),
      e.paidFromCash ? t('exp_x_yes') : t('exp_x_no'),
      e.status === 'voided' ? t('exp_badge_voided') : t('exp_x_active'),
      e.amount,
      e.createdByName,
      e.voidReason ?? '',
    ]);
  }
  const active = rows.filter((e) => e.status === 'active').reduce((sum, e) => sum + e.amount, 0);
  const total = sheet.addRow([t('exp_x_total_active'), '', '', '', '', '', '', '', active]);
  total.font = { bold: true };
  sheet.getColumn(1).numFmt = 'yyyy-mm-dd';
  sheet.getColumn(9).numFmt = MONEY_FMT;
  sheet.views = [{ state: 'frozen', ySplit: 3 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------- PDF ---------- */

const GOLD = '#8a6a35';
const MUTED = '#6b6458';
const GREEN = '#1f7a45';
const RED = '#b23a2c';

/**
 * Las fuentes estándar del PDF (Helvetica) solo traen el juego de caracteres occidental: el signo menos tipográfico, las
 * flechas o los emojis saldrían como basura. Se reemplazan por equivalentes simples.
 */
const pdfSafe = (text: string) =>
  text
    .replace(/[−–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '');

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

export function buildBalancePdf(data: BalanceExportData, lang: Language, options: { compress?: boolean } = {}): Promise<Buffer> {
  const t = texts(lang);
  const { balance, business } = data;
  const money = (amount: number) => pdfSafe(formatMoney(amount, business.currency));
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, compress: options.compress ?? true, info: { Title: `${t('bal_title')} - ${business.name}`, Author: business.name, Creator: 'XIRO' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 24;
  const text = (value: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions = {}) => doc.text(pdfSafe(value), x, y, { lineBreak: false, ...opts });

  // Encabezado
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#000');
  text(business.name, left, 40, { width: contentWidth, ellipsis: true });
  const address = [business.address, business.city].filter(Boolean).join(', ');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  if (address) text(address, left, 62, { width: contentWidth, ellipsis: true });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(GOLD);
  text(t('bal_title'), left, 80);
  doc.font('Helvetica').fontSize(10).fillColor('#000');
  text(`${t('bal_period')}: ${rangeLabel(balance.from, balance.to, lang)}`, left, 100);
  doc.fillColor(MUTED).fontSize(9);
  text(`${t('bal_x_previous')}: ${rangeLabel(balance.previous.from, balance.previous.to, lang)}  ·  ${t('bal_x_generated', { date: generatedLabel(data.generatedAt, business.timezone, lang) })}`, left, 114, { width: contentWidth, ellipsis: true });
  let y = 136;

  /** Tabla simple con salto de página (repite el encabezado en cada página). */
  const table = (columns: Column[], rows: Array<{ cells: string[]; bold?: boolean; colors?: Array<string | undefined> }>) => {
    const header = () => {
      doc.rect(left, y, contentWidth, 18).fill(GOLD);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
      let x = left;
      for (const col of columns) {
        text(col.label, x + 4, y + 5, { width: col.width - 8, align: col.align ?? 'left', ellipsis: true });
        x += col.width;
      }
      y += 18;
    };
    header();
    rows.forEach((row, index) => {
      if (y + 16 > bottom()) {
        doc.addPage();
        y = doc.page.margins.top;
        header();
      }
      if (index % 2 === 1) doc.rect(left, y, contentWidth, 16).fill('#f4efe6');
      doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      let x = left;
      row.cells.forEach((cell, i) => {
        const col = columns[i]!;
        doc.fillColor(row.colors?.[i] ?? '#000');
        text(cell, x + 4, y + 4, { width: col.width - 8, height: 10, align: col.align ?? 'left', ellipsis: true });
        x += col.width;
      });
      y += 16;
    });
    y += 14;
  };
  const section = (title: string, minSpace = 60) => {
    if (y + minSpace > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000');
    text(title, left, y);
    y += 18;
  };

  // Resumen
  const w = contentWidth;
  table(
    [
      { label: t('bal_x_concept'), width: w * 0.37 },
      { label: t('bal_period'), width: w * 0.21, align: 'right' },
      { label: t('bal_x_previous'), width: w * 0.21, align: 'right' },
      { label: t('bal_x_change'), width: w * 0.21, align: 'right' },
    ],
    [
      ...summaryRows(balance, t, lang).map((r) => ({ cells: [r.label, money(r.value), money(r.previous), r.change], bold: r.strong, colors: [undefined, r.value < 0 ? RED : undefined, r.previous < 0 ? RED : undefined] })),
      {
        // Sin ingresos no hay margen: la explicación va en la columna ancha del concepto y las cifras quedan en "—".
        cells: [
          balance.totals.margin === null ? `${t('bal_x_margin')} (${t('bal_no_margin').toLowerCase()})` : t('bal_x_margin'),
          balance.totals.margin === null ? '—' : percentLabel(balance.totals.margin, lang),
          balance.previous.totals.margin === null ? '—' : percentLabel(balance.previous.totals.margin, lang),
          '',
        ],
      },
      { cells: [t('bal_x_tips'), money(balance.totals.tips), money(balance.previous.totals.tips), ''], colors: [MUTED, MUTED, MUTED] },
    ],
  );

  // Gráfico de barras: ingresos vs. gastos por periodo (vectorial, se imprime nítido).
  const buckets = balance.series.buckets;
  if (buckets.some((b) => b.income > 0 || b.expenses > 0)) {
    section(`${t('bal_chart_bars')} · ${t(`bal_grouping_${balance.series.grouping}`)}`, 170);
    const chartH = 120;
    const max = Math.max(1, ...buckets.flatMap((b) => [b.income, b.expenses]));
    const column = contentWidth / buckets.length;
    const bar = Math.max(1, Math.min(14, (column * 0.7) / 2));
    doc.moveTo(left, y + chartH).lineTo(left + contentWidth, y + chartH).lineWidth(0.5).strokeColor('#bbb').stroke();
    buckets.forEach((b, i) => {
      const center = left + column * (i + 0.5);
      const hi = (b.income / max) * chartH;
      const he = (b.expenses / max) * chartH;
      if (hi > 0) doc.rect(center - bar, y + chartH - hi, bar, hi).fill(GREEN);
      if (he > 0) doc.rect(center, y + chartH - he, bar, he).fill(RED);
    });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED);
    const every = Math.ceil(buckets.length / 8);
    buckets.forEach((b, i) => {
      if (i % every === 0 || i === buckets.length - 1) text(shortDay(b.from, lang), left + column * i - 10, y + chartH + 4, { width: column + 20, align: 'center' });
    });
    doc.rect(left, y + chartH + 18, 8, 8).fill(GREEN);
    doc.fillColor('#000').fontSize(8);
    text(t('bal_income'), left + 12, y + chartH + 18);
    doc.rect(left + 90, y + chartH + 18, 8, 8).fill(RED);
    doc.fillColor('#000');
    text(t('bal_chart_expenses'), left + 102, y + chartH + 18);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    text(`max ${money(max)}`, left, y - 2, { width: contentWidth, align: 'right' });
    y += chartH + 40;
  }

  // Por periodo
  section(`${t('bal_x_sheet_periods')} · ${t(`bal_grouping_${balance.series.grouping}`)}`);
  table(
    [
      { label: t('bal_period'), width: w * 0.34 },
      { label: t('bal_income'), width: w * 0.22, align: 'right' },
      { label: t('bal_chart_expenses'), width: w * 0.22, align: 'right' },
      { label: t('bal_net'), width: w * 0.22, align: 'right' },
    ],
    [
      ...buckets.map((b) => ({ cells: [rangeLabel(b.from, b.to, lang), money(b.income), money(b.expenses), money(b.net)], colors: [undefined, undefined, undefined, b.net < 0 ? RED : undefined] })),
      { cells: [t('bal_x_total'), money(balance.totals.income), money(balance.totals.operating + balance.totals.payroll), money(balance.totals.net)], bold: true },
    ],
  );

  // Gastos por categoría
  if (balance.expenseBreakdown.length > 0) {
    section(t('bal_x_sheet_categories'));
    const spent = balance.expenseBreakdown.reduce((sum, s) => sum + s.amount, 0);
    table(
      [
        { label: t('bal_x_category'), width: w * 0.4 },
        { label: t('bal_x_type'), width: w * 0.24 },
        { label: t('bal_x_amount'), width: w * 0.2, align: 'right' },
        { label: t('bal_x_share'), width: w * 0.16, align: 'right' },
      ],
      [
        ...balance.expenseBreakdown.map((s) => ({ cells: [t(`exp_cat_${s.category}`), t(`exp_type_${s.type}`), money(s.amount), percentLabel(Math.round((s.amount / spent) * 1000) / 10, lang)] })),
        { cells: [t('bal_x_total'), '', money(spent), percentLabel(100, lang)], bold: true },
      ],
    );
  }

  // Movimientos
  section(t('bal_x_sheet_movements'));
  table(
    [
      { label: t('bal_x_date'), width: w * 0.13 },
      { label: t('bal_x_type'), width: w * 0.15 },
      { label: t('bal_x_category'), width: w * 0.16 },
      { label: t('bal_x_description'), width: w * 0.28 },
      { label: t('bal_x_in'), width: w * 0.14, align: 'right' },
      { label: t('bal_x_out'), width: w * 0.14, align: 'right' },
    ],
    [
      ...data.movements.map((m) => ({
        cells: [localDate(new Date(m.at), business.timezone), movementKind(m, t), movementCategory(m, t), m.description, m.direction === 'in' ? money(m.amount) : '', m.direction === 'out' ? money(m.amount) : ''],
        colors: [undefined, undefined, undefined, undefined, GREEN, RED],
      })),
      {
        cells: [
          t('bal_x_total'),
          '',
          '',
          '',
          money(data.movements.filter((m) => m.direction === 'in').reduce((s, m) => s + m.amount, 0)),
          money(data.movements.filter((m) => m.direction === 'out').reduce((s, m) => s + m.amount, 0)),
        ],
        bold: true,
      },
    ],
  );
  if (data.movementsTotal > data.movements.length) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED);
    text(t('bal_x_truncated', { count: data.movements.length }), left, y - 8);
  }

  // Pie: número de página en todas las hojas.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Sin margen inferior mientras se escribe el pie: si no, pdfkit cree que el texto "no cabe" y agrega hojas en blanco.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    text(`${business.name} · ${t('bal_title')} · ${t('bal_x_page', { page: i + 1, pages: range.count })}`, left, doc.page.height - margin + 14, { width: contentWidth, align: 'center' });
    doc.page.margins.bottom = margin;
  }
  doc.end();
  return done;
}

/** "balance-mi-negocio-2026-10-01_2026-10-13.pdf": solo letras, números y guiones (el slug ya lo es; se limpia igual). */
export function exportFileName(kind: string, slug: string, from: string, to: string, format: 'pdf' | 'xlsx'): string {
  const safe = slug.replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'negocio';
  return `${kind}-${safe}-${from}_${to}.${format}`;
}
