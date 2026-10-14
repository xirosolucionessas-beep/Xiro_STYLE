import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL_EXPENSE_CATEGORIES, EXPENSE_TYPES, SALE_PAYMENT_METHODS, translate } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { meets, routeRequirement } from '../src/lib/access';
import { menuFor } from '../src/lib/menu';
import { NAV_ITEMS } from '../src/web/shell/nav';
import { describeRoute } from '../src/web/shell/routes';
import { periodRange } from '../src/lib/expenses';

/** Módulo Finanzas, fase 3: la pantalla de Gastos solo existe para el dueño y para quien tiene el permiso "Finanzas". */
const owner = { role: 'owner' as const, permissions: [] };
const employee = (...permissions: Array<'finance' | 'services_record' | 'clients_view' | 'agenda_all'>) => ({ role: 'employee' as const, permissions });
const menuIds = (actor: Parameters<typeof menuFor>[0]) => menuFor(actor).flatMap((s) => s.items.map((i) => i.id));
const navIds = (actor: Parameters<typeof meets>[0]) => NAV_ITEMS.filter((item) => meets(actor, item.requires)).map((i) => i.id);

describe('permisos de Gastos en la navegación', () => {
  it('el empleado sin "Finanzas" no ve Gastos (ni en el menú móvil ni en la barra web) y la ruta lo redirige', () => {
    const worker = employee('services_record', 'clients_view', 'agenda_all');
    expect(menuIds(worker)).not.toContain('expenses');
    expect(navIds(worker)).not.toContain('expenses');
    expect(meets(worker, routeRequirement('/expenses'))).toBe(false);
  });

  it('el dueño y el empleado con "Finanzas" lo ven, justo debajo de Pedidos', () => {
    for (const actor of [owner, employee('finance', 'services_record')]) {
      expect(meets(actor, routeRequirement('/expenses'))).toBe(true);
      const nav = navIds(actor);
      expect(nav.indexOf('expenses')).toBe(nav.indexOf('orders') + 1);
      const menu = menuIds(actor);
      expect(menu.indexOf('expenses')).toBe(menu.indexOf('orders') + 1);
    }
    // Con "Finanzas" pero sin poder registrar ventas (sin Pedidos), Gastos sigue disponible.
    expect(navIds(employee('finance'))).toContain('expenses');
  });

  it('la ruta web tiene su título y su sección', () => {
    expect(describeRoute('/expenses')).toMatchObject({ titleKey: 'nav_expenses', section: 'expenses' });
  });

  it('el acceso rápido "Registrar gasto" del Inicio (web y móvil) exige "Finanzas"', () => {
    const web = readFileSync(path.resolve(__dirname, '../src/app/(app)/(tabs)/index.web.tsx'), 'utf8');
    expect(web).toMatch(/id: 'register_expense'[^\n]*requires: \['finance'\]/);
    const native = readFileSync(path.resolve(__dirname, '../src/app/(app)/(tabs)/index.tsx'), 'utf8');
    expect(native).toMatch(/meets\(actor, \['finance'\]\) \? \[\{ id: 'expense'/);
  });
});

describe('atajos de periodo (hora del negocio)', () => {
  it('este mes, mes anterior (con años y meses de 28–31 días), últimos 7 días y este año', () => {
    expect(periodRange('this_month', '2026-10-13')).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    expect(periodRange('last_month', '2026-03-05')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('last_month', '2026-01-20')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('last_7', '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' });
    expect(periodRange('this_year', '2026-10-13')).toEqual({ from: '2026-01-01', to: '2026-10-13' });
  });
});

describe('textos de Gastos', () => {
  it('cada texto de la pantalla, tipo, categoría y método existe en español e inglés', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/app/(app)/expenses.tsx'), 'utf8');
    const keys = new Set([...source.matchAll(/\bt\('([a-z][a-z0-9_]*)'/g)].map((m) => m[1]!));
    for (const type of [...EXPENSE_TYPES, 'all']) keys.add(`exp_type_${type}`);
    for (const category of ALL_EXPENSE_CATEGORIES) keys.add(`exp_cat_${category}`);
    for (const method of SALE_PAYMENT_METHODS) keys.add(`sale_pay_${method}`);
    for (const p of ['this_month', 'last_month', 'last_7', 'this_year']) keys.add(`exp_period_${p}`);
    keys.add('home_register_expense');
    keys.add('nav_expenses');
    const missing = [...keys].flatMap((key) => (['es', 'en'] as const).filter((lang) => translate(lang, key) === key).map((lang) => `${lang}:${key}`));
    expect(missing).toEqual([]);
  });
});

describe('listado completo (paginado)', () => {
  const screen = () => readFileSync(path.resolve(__dirname, '../src/app/(app)/expenses.tsx'), 'utf8');
  it('usa el listado por páginas y los totales del servidor (nunca suma solo lo cargado)', () => {
    const source = screen();
    expect(source).toContain('useExpensePages(query)');
    expect(source).toContain('const totals = list.data?.pages[0]?.summary ?? null;');
    expect(source).not.toMatch(/rows\.filter\(\(e\) => e\.status === 'active'\)\.reduce/);
  });

  it('"Cargar más" y "Mostrando X de Y" existen en ambos idiomas', () => {
    expect(screen()).toContain("t('exp_load_more')");
    for (const key of ['exp_load_more', 'exp_showing', 'export_too_many_rows']) for (const lang of ['es', 'en'] as const) expect(translate(lang, key), `${lang}:${key}`).not.toBe(key);
  });
});

describe('monto en el formulario', () => {
  it('valida con la misma regla que la API antes de enviar y muestra el rango mientras está vacío', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/app/(app)/expenses.tsx'), 'utf8');
    expect(source).toContain("error={fields.amount ?? (amount && expenseAmountIssue(amount) ? t(expenseAmountIssue(amount)!) : undefined)}");
    expect(source).toContain("hint={amount ? formatMoney(Number(amount), business.currency as Currency) : t('exp_amount_hint')}");
    expect(source).toContain('expenseAmountIssue(amount) !== null');
  });
});
