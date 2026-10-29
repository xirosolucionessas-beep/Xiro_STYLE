import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BALANCE_PRESETS, presetRange, translate, withinExportLimit } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { meets, routeRequirement } from '../src/lib/access';
import { arcPath, bucketLabel, compactMoney, donutSlices, labelIndexes, niceScale, rangeFromParams } from '../src/lib/balance';
import { menuFor } from '../src/lib/menu';
import { NAV_ITEMS } from '../src/web/shell/nav';
import { describeRoute } from '../src/web/shell/routes';

/** Finanzas, fase 4 — Reportes → Balance general: permisos, rango en la URL, atajos de fecha y textos. */
const owner = { role: 'owner' as const, permissions: [] };
const employee = (...permissions: Array<'finance' | 'services_record' | 'clients_view'>) => ({ role: 'employee' as const, permissions });
const read = (file: string) => readFileSync(path.resolve(__dirname, '../src', file), 'utf8');

describe('permisos del Balance general', () => {
  it('el empleado sin "Finanzas" no ve Reportes ni el balance; el dueño y "Finanzas" sí', () => {
    const worker = employee('services_record', 'clients_view');
    for (const route of ['/reports', '/reports/balance']) {
      expect(meets(worker, routeRequirement(route)), route).toBe(false);
      expect(meets(owner, routeRequirement(route)), route).toBe(true);
      expect(meets(employee('finance'), routeRequirement(route)), route).toBe(true);
    }
    expect(menuFor(worker).flatMap((s) => s.items.map((i) => i.id))).not.toContain('reports');
    expect(NAV_ITEMS.filter((i) => meets(worker, i.requires)).map((i) => i.id)).not.toContain('reports');
    expect(NAV_ITEMS.filter((i) => meets(employee('finance'), i.requires)).map((i) => i.id)).toContain('reports');
  });

  it('Reportes → Ventas sigue siendo solo del dueño: quien entra con "Finanzas" va al balance', () => {
    for (const file of ['app/(app)/reports.tsx', 'app/(app)/reports.web.tsx']) {
      expect(read(file), file).toMatch(/if \(user\.role !== 'owner'\) return <Redirect href="\/reports\/balance" \/>;/);
    }
    expect(read('app/(app)/reports/balance.tsx')).toContain("showSales={user.role === 'owner'}");
  });

  it('la ruta web tiene título y queda dentro de la sección Reportes', () => {
    expect(describeRoute('/reports/balance')).toMatchObject({ titleKey: 'rep_tab_balance', section: 'reports' });
  });
});

describe('rango del balance', () => {
  const today = '2026-10-13'; // martes
  it('atajos: semana de lunes a domingo, mes anterior y año, nunca después de hoy', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today });
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-10-12', to: '2026-10-12' });
    expect(presetRange('this_week', today)).toEqual({ from: '2026-10-12', to: today });
    expect(presetRange('last_week', today)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(presetRange('this_month', today)).toEqual({ from: '2026-10-01', to: today });
    expect(presetRange('last_month', '2026-03-05')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetRange('this_year', today)).toEqual({ from: '2026-01-01', to: today });
    for (const p of BALANCE_PRESETS) expect(presetRange(p, today).to <= today, p).toBe(true);
  });

  it('lee el rango de la URL; si no es válido muestra el error o vuelve a "Mes actual"', () => {
    expect(rangeFromParams({}, today)).toEqual({ preset: 'this_month', from: '2026-10-01', to: today });
    expect(rangeFromParams({ preset: 'last_week' }, today)).toMatchObject({ from: '2026-10-05', to: '2026-10-11' });
    expect(rangeFromParams({ preset: 'cualquier-cosa' }, today)).toMatchObject({ preset: 'this_month' });
    expect(rangeFromParams({ preset: 'custom', from: '2026-09-01', to: '2026-09-15' }, today)).toEqual({ preset: 'custom', from: '2026-09-01', to: '2026-09-15' });
    expect(rangeFromParams({ from: '2026-09-01', to: '2026-09-15' }, today)).toMatchObject({ preset: 'custom' });
    expect(rangeFromParams({ preset: 'custom', from: '2026-09-15', to: '2026-09-01' }, today).error).toBe('range_invalid');
    expect(rangeFromParams({ preset: 'custom', from: today, to: '2026-10-20' }, today).error).toBe('range_future');
  });
});

describe('textos del balance', () => {
  it('cada texto de la pantalla y de las pestañas existe en español e inglés', () => {
    const source = read('app/(app)/reports/balance.tsx') + read('ui/reports/ReportsTabs.tsx') + read('ui/reports/BalanceCharts.tsx') + read('ui/reports/DownloadButton.tsx');
    const keys = new Set([...source.matchAll(/\bt\('([a-z][a-z0-9_]*)'/g)].map((m) => m[1]!));
    for (const p of [...BALANCE_PRESETS, 'custom']) keys.add(`bal_preset_${p}`);
    for (const k of ['service', 'product', 'discount', 'operating', 'payroll']) keys.add(`bal_kind_${k}`);
    for (const k of ['all', 'income', 'expense']) keys.add(`bal_filter_${k}`);
    for (const k of ['date', 'amount']) keys.add(`bal_sort_${k}`);
    for (const k of ['day', 'week', 'month']) keys.add(`bal_grouping_${k}`);
    for (const k of ['range_invalid', 'range_future', 'rep_tab_balance']) keys.add(k);
    const missing = [...keys].flatMap((key) => (['es', 'en'] as const).filter((lang) => translate(lang, key) === key).map((lang) => `${lang}:${key}`));
    expect(missing).toEqual([]);
  });
});

describe('gráficos del balance', () => {
  it('etiquetas por día, semana (su primer día dentro del rango) y mes', () => {
    expect(bucketLabel({ key: '2026-10-13', from: '2026-10-13' }, 'day', 'es')).toBe('13 oct');
    expect(bucketLabel({ key: '2026-04-27', from: '2026-05-01' }, 'week', 'es')).toBe('1 may');
    expect(bucketLabel({ key: '2026-10-01', from: '2026-10-15' }, 'month', 'en')).toMatch(/^Oct 26$/);
  });

  it('montos compactos para los ejes, con signo', () => {
    expect(compactMoney(0, 'es')).toBe('$0');
    expect(compactMoney(450_000, 'es')).toBe('$450 k');
    expect(compactMoney(1_250_000, 'es')).toBe('$1,3 M');
    expect(compactMoney(-80_000, 'en')).toBe('−$80 k');
  });

  it('la escala del eje incluye el cero y usa pasos redondos', () => {
    expect(niceScale([0, 0])).toEqual({ min: 0, max: 1, step: 1 });
    expect(niceScale([120_000, 430_000])).toEqual({ min: 0, max: 600_000, step: 200_000 });
    const mixed = niceScale([-90_000, 310_000]);
    expect(mixed.min).toBeLessThanOrEqual(-90_000);
    expect(mixed.max).toBeGreaterThanOrEqual(310_000);
    expect(Math.abs(mixed.min % mixed.step)).toBe(0);
  });

  it('la dona reparte el 100 % sin huecos; sin gastos no hay porciones', () => {
    const slices = donutSlices([{ amount: 300 }, { amount: 100 }]);
    expect(slices.map((s) => [s.fraction, s.start])).toEqual([[0.75, 0], [0.25, 0.75]]);
    expect(donutSlices([{ amount: 0 }])).toEqual([]);
  });

  it('las etiquetas del eje X no se amontonan y siempre muestran el primero y el último', () => {
    expect([...labelIndexes(5)]).toEqual([0, 1, 2, 3, 4]);
    const many = labelIndexes(31, 7);
    expect(many.size).toBe(7);
    expect(many.has(0) && many.has(30)).toBe(true);
  });
});

describe('arcos de la dona', () => {
  it('empiezan a las 12 en punto, van en el sentido del reloj y marcan el arco largo pasado el 50 %', () => {
    expect(arcPath(80, 58, 0, Math.PI / 2)).toBe('M 80 22 A 58 58 0 0 1 138 80');
    expect(arcPath(80, 58, 0, Math.PI * 1.5)).toBe('M 80 22 A 58 58 0 1 1 22 80');
  });
});

describe('descargas (fase 6)', () => {
  it('máximo 12 meses de calendario (un año bisiesto cabe completo); un día más ya no', () => {
    expect(withinExportLimit('2025-01-01', '2025-12-31')).toBe(true);
    expect(withinExportLimit('2024-01-01', '2024-12-31')).toBe(true);
    expect(withinExportLimit('2025-03-15', '2026-03-14')).toBe(true);
    expect(withinExportLimit('2025-03-15', '2026-03-15')).toBe(false);
    expect(withinExportLimit('2025-01-01', '2026-01-01')).toBe(false);
    // Fecha mal formada: no lanza (la validación de formato es la que responde).
    expect(() => withinExportLimit('2020-01-01T00:00:00Z', 'x')).not.toThrow();
  });

  it('el balance ofrece PDF y Excel (desactivados pasado el límite) y Gastos su Excel con los filtros de la lista', () => {
    const balance = read('app/(app)/reports/balance.tsx');
    expect(balance).toContain("api.balanceExport(format, { from: range.from, to: range.to, lang: language })");
    expect(balance).toContain('disabled={!valid || !exportAllowed}');
    const expenses = read('app/(app)/expenses.tsx');
    expect(expenses).toContain('api.expensesExport({ ...query, lang: language })');
    for (const key of ['bal_download_pdf', 'bal_download_xlsx', 'bal_download_limit', 'bal_download_done', 'bal_download_unavailable', 'exp_download_xlsx', 'export_range_too_long']) {
      for (const lang of ['es', 'en'] as const) expect(translate(lang, key), `${lang}:${key}`).not.toBe(key);
    }
  });
});
