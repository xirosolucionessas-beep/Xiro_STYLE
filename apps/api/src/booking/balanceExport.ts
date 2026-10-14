import { PassThrough } from 'node:stream';
import { EXPORT_MAX_ROWS, formatMoney, translate, type BalanceDto, type BalanceMovementDto, type Currency, type ExpenseDto, type Language } from '@xiro/shared';
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

/**
 * Movimientos por archivo. Excel: TODOS hasta EXPORT_MAX_ROWS (por encima, la ruta responde 400 `export_too_many_rows`).
 * PDF: los primeros PDF_MAX_MOVEMENTS y el archivo lo dice (un PDF de cientos de páginas no se lee y consume mucha memoria
 * del servidor); los totales, la gráfica y las tablas por periodo y categoría del PDF siempre son del periodo COMPLETO.
 */
export const PDF_MAX_MOVEMENTS = 2000;

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
  /** Movimientos del periodo en total (si pasa de los incluidos, el archivo lo dice). */
  movementsTotal: number;
  generatedAt: Date;
}

export async function loadBalanceExport(tx: Tx, businessId: string, business: ExportBusiness, from: string, to: string, maxMovements: number = EXPORT_MAX_ROWS): Promise<BalanceExportData> {
  const balance = await computeBalance(tx, businessId, from, to, business.timezone);
  const page = await balanceMovements(tx, businessId, { from, to, kind: 'all', sort: 'date', dir: 'asc', page: 1, pageSize: maxMovements }, business.timezone);
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
const DATE_FMT = 'yyyy-mm-dd';
const PERCENT_FMT = '0.0%';

type Sheet = ExcelJS.Worksheet;
type RowStyle = { font?: Partial<ExcelJS.Font>; header?: boolean; formats?: Record<number, string> };

/** Fecha local "AAAA-MM-DD" como celda de fecha real de Excel (medianoche UTC: Excel no guarda zona horaria). */
const excelDate = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Libro escrito POR FLUJO (WorkbookWriter): cada fila se escribe, se comprime y se suelta, así que la memoria no crece con el
 * tamaño del archivo. Medido (docs/finance-capacity.md): un Excel de 50.000 filas armado en memoria pedía ~450 MB de heap
 * (y tumbaba un proceso de 384 MB); por flujo, ~35 MB y en la mitad del tiempo.
 */
async function streamedWorkbook(meta: { created?: Date }, build: (wb: ExcelJS.stream.xlsx.WorkbookWriter) => Promise<void>): Promise<Buffer> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    out.once('end', resolve);
    out.once('error', reject);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = 'XIRO';
  if (meta.created) wb.created = meta.created;
  await build(wb);
  await wb.commit();
  await ended;
  return Buffer.concat(chunks);
}

/** Agrega una fila con su estilo y la suelta (commit). Cada 2.000 filas cede el turno al resto del hilo. */
let written = 0;
async function put(sheet: Sheet, values: unknown[], style: RowStyle = {}): Promise<void> {
  const row = sheet.addRow(values);
  if (style.header) {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8A6A35' } };
    row.alignment = { vertical: 'middle' };
  } else if (style.font) row.font = style.font;
  for (const [col, numFmt] of Object.entries(style.formats ?? {})) row.getCell(Number(col)).numFmt = numFmt;
  row.commit();
  if (++written % 2000 === 0) await new Promise((resolve) => setImmediate(resolve));
}

export async function buildBalanceXlsx(data: BalanceExportData, lang: Language): Promise<Buffer> {
  const t = texts(lang);
  const { balance, business } = data;
  return streamedWorkbook({ created: data.generatedAt }, async (wb) => {
    // Resumen
    const summary = wb.addWorksheet(t('bal_x_sheet_summary'));
    summary.columns = [{ width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }];
    const money = { 2: MONEY_FMT, 3: MONEY_FMT };
    await put(summary, [business.name], { font: { bold: true, size: 14 } });
    await put(summary, [t('bal_title')], { font: { bold: true, size: 12 } });
    await put(summary, [`${t('bal_period')}: ${rangeLabel(balance.from, balance.to, lang)}`]);
    await put(summary, [`${t('bal_x_previous')}: ${rangeLabel(balance.previous.from, balance.previous.to, lang)}`]);
    await put(summary, [t('bal_x_generated', { date: generatedLabel(data.generatedAt, business.timezone, lang) })], { font: { italic: true, color: { argb: 'FF777777' } } });
    await put(summary, []);
    await put(summary, [t('bal_x_concept'), t('bal_period'), t('bal_x_previous'), t('bal_x_change')], { header: true });
    for (const r of summaryRows(balance, t, lang)) await put(summary, [r.label, r.value, r.previous, r.change], { font: r.strong ? { bold: true } : undefined, formats: money });
    // El margen va en porcentaje.
    await put(summary, [t('bal_x_margin'), balance.totals.margin === null ? t('bal_no_margin') : balance.totals.margin / 100, balance.previous.totals.margin === null ? '' : balance.previous.totals.margin / 100], { formats: { 2: PERCENT_FMT, 3: PERCENT_FMT } });
    await put(summary, [t('bal_x_tips'), balance.totals.tips, balance.previous.totals.tips], { formats: money });
    summary.commit();

    // Por periodo (lo mismo que los gráficos)
    const periods = wb.addWorksheet(t('bal_x_sheet_periods'), { views: [{ state: 'frozen', ySplit: 1 }] });
    periods.columns = [{ width: 14 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 18 }];
    const periodFormats = { 1: DATE_FMT, 2: DATE_FMT, 3: MONEY_FMT, 4: MONEY_FMT, 5: MONEY_FMT };
    await put(periods, [t('bal_from'), t('bal_to'), t('bal_income'), t('bal_chart_expenses'), t('bal_net')], { header: true });
    for (const b of balance.series.buckets) await put(periods, [excelDate(b.from), excelDate(b.to), b.income, b.expenses, b.net], { formats: periodFormats });
    await put(periods, [t('bal_x_total'), '', balance.totals.income, balance.totals.operating + balance.totals.payroll, balance.totals.net], { font: { bold: true }, formats: periodFormats });
    periods.commit();

    // Gastos por categoría (la dona)
    const categories = wb.addWorksheet(t('bal_x_sheet_categories'));
    categories.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 14 }];
    const categoryFormats = { 3: MONEY_FMT, 4: PERCENT_FMT };
    await put(categories, [t('bal_x_category'), t('bal_x_type'), t('bal_x_amount'), t('bal_x_share')], { header: true });
    const spent = balance.expenseBreakdown.reduce((sum, s) => sum + s.amount, 0);
    for (const s of balance.expenseBreakdown) await put(categories, [t(`exp_cat_${s.category}`), t(`exp_type_${s.type}`), s.amount, spent > 0 ? s.amount / spent : 0], { formats: categoryFormats });
    await put(categories, [t('bal_x_total'), '', spent, spent > 0 ? 1 : 0], { font: { bold: true }, formats: categoryFormats });
    categories.commit();

    // Movimientos
    const moves = wb.addWorksheet(t('bal_x_sheet_movements'), { views: [{ state: 'frozen', ySplit: 1 }] });
    moves.columns = [{ width: 12 }, { width: 18 }, { width: 22 }, { width: 44 }, { width: 16 }, { width: 16 }];
    const moveFormats = { 1: DATE_FMT, 5: MONEY_FMT, 6: MONEY_FMT };
    await put(moves, [t('bal_x_date'), t('bal_x_type'), t('bal_x_category'), t('bal_x_description'), t('bal_x_in'), t('bal_x_out')], { header: true });
    let totalIn = 0;
    let totalOut = 0;
    for (const m of data.movements) {
      if (m.direction === 'in') totalIn += m.amount;
      else totalOut += m.amount;
      const day = localDate(new Date(m.at), business.timezone);
      await put(moves, [excelDate(day), movementKind(m, t), movementCategory(m, t), m.description, m.direction === 'in' ? m.amount : null, m.direction === 'out' ? m.amount : null], { formats: moveFormats });
    }
    await put(moves, [t(data.movementsTotal > data.movements.length ? 'bal_x_total_shown' : 'bal_x_total'), '', '', '', totalIn, totalOut], { font: { bold: true }, formats: { 5: MONEY_FMT, 6: MONEY_FMT } });
    if (data.movementsTotal > data.movements.length) await put(moves, [t('bal_x_truncated', { count: data.movements.length })], { font: { italic: true } });
    moves.commit();
  });
}

export async function buildExpensesXlsx(rows: ExpenseDto[], business: ExportBusiness, range: { from: string; to: string }, lang: Language): Promise<Buffer> {
  const t = texts(lang);
  return streamedWorkbook({}, async (wb) => {
    const sheet = wb.addWorksheet(t('exp_x_title'), { views: [{ state: 'frozen', ySplit: 3 }] });
    sheet.columns = [{ width: 12 }, { width: 14 }, { width: 22 }, { width: 40 }, { width: 22 }, { width: 18 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 22 }, { width: 30 }];
    await put(sheet, [`${business.name} · ${t('exp_x_title')} · ${rangeLabel(range.from, range.to, lang)}`], { font: { bold: true, size: 13 } });
    await put(sheet, []);
    await put(
      sheet,
      [
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
      ],
      { header: true },
    );
    const formats = { 1: DATE_FMT, 9: MONEY_FMT };
    let active = 0;
    for (const e of rows) {
      if (e.status === 'active') active += e.amount;
      await put(
        sheet,
        [
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
        ],
        { formats },
      );
    }
    await put(sheet, [t('exp_x_total_active'), '', '', '', '', '', '', '', active], { font: { bold: true }, formats: { 9: MONEY_FMT } });
    sheet.commit();
  });
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
        // Recortado: 'Total de lo incluido' va en la columna ancha (descripción); completo: 'Total' en la primera, como siempre.
        cells: [
          data.movementsTotal > data.movements.length ? '' : t('bal_x_total'),
          '',
          '',
          data.movementsTotal > data.movements.length ? t('bal_x_total_shown') : '',
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
