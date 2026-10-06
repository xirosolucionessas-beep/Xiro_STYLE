import { existsSync } from 'node:fs';
import path from 'node:path';
import { translate } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { routeRequirement } from '../src/lib/access';
import { isCurrentItem, MENU_SECTIONS, menuFor } from '../src/lib/menu';

const APP = path.resolve(__dirname, '../src/app/(app)');
/** ¿Existe una pantalla para esta ruta? (pestañas en (tabs), el resto directo en (app), con o sin variante web). */
const routeExists = (href: string) => {
  if (href === '/') return existsSync(path.join(APP, '(tabs)', 'index.tsx'));
  const name = href.slice(1);
  return existsSync(path.join(APP, '(tabs)', `${name}.tsx`)) || existsSync(path.join(APP, `${name}.tsx`));
};

const owner = { role: 'owner' as const, permissions: [] };
const employee = (...permissions: Array<'clients_view' | 'catalog_view' | 'catalog_manage' | 'services_record' | 'loyalty_redeem' | 'clients_manage'>) => ({ role: 'employee' as const, permissions });
const ids = (sections: ReturnType<typeof menuFor>) => sections.flatMap((section) => section.items.map((item) => item.id));

describe('menú lateral: todas las funciones, sin pantallas vacías', () => {
  const items = MENU_SECTIONS.flatMap((section) => section.items);

  it('cada opción con ruta lleva a una pantalla que EXISTE', () => {
    for (const item of items.filter((i) => i.href)) expect(routeExists(item.href!), `${item.id} → ${item.href}`).toBe(true);
  });

  it('las opciones sin ruta son módulos "Próximamente" (nunca una pantalla vacía)', () => {
    for (const item of items.filter((i) => !i.href)) expect(item.soon, item.id).toBe(true);
  });

  it('el menú y el guardián de rutas piden lo mismo para cada pantalla', () => {
    for (const item of items.filter((i) => i.href)) expect(routeRequirement(item.href!), item.id).toEqual(item.requires);
  });

  it('incluye todas las funciones de la app', () => {
    expect(ids(MENU_SECTIONS)).toEqual(
      expect.arrayContaining(['home', 'appointments', 'clients', 'catalog', 'inventory', 'team', 'loyalty', 'cash_base', 'cash_close', 'business', 'categories', 'plan', 'reports', 'assistant']),
    );
  });

  it('todos los textos existen en ES y EN, y los ids no se repiten', () => {
    for (const key of [...items.map((i) => i.labelKey), ...MENU_SECTIONS.map((s) => s.titleKey)]) {
      expect(translate('es', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
    }
    expect(new Set(ids(MENU_SECTIONS)).size).toBe(ids(MENU_SECTIONS).length);
  });
});

describe('qué ve cada persona', () => {
  it('el dueño ve todo', () => {
    expect(ids(menuFor(owner))).toEqual(ids(MENU_SECTIONS));
  });

  it('un empleado sin permisos solo ve Inicio y el asistente ("Próximamente"); las secciones vacías se ocultan', () => {
    const result = menuFor(employee());
    expect(ids(result)).toEqual(['home', 'messages', 'assistant']);
    expect(result.map((s) => s.id)).toEqual(['main', 'assistant']);
  });

  it('cada permiso abre su módulo y nada más del dueño', () => {
    const result = ids(menuFor(employee('clients_view', 'catalog_view', 'services_record', 'catalog_manage')));
    expect(result).toEqual(expect.arrayContaining(['clients', 'catalog', 'inventory', 'loyalty', 'categories']));
    for (const hidden of ['team', 'cash_base', 'cash_close', 'business', 'plan', 'reports', 'appointments']) expect(result).not.toContain(hidden);
  });

  it('sin actor (sesión cargando) no se oculta nada', () => {
    expect(ids(menuFor(null))).toEqual(ids(MENU_SECTIONS));
  });
});

describe('opción actual resaltada', () => {
  const find = (id: string) => MENU_SECTIONS.flatMap((s) => s.items).find((i) => i.id === id)!;
  it('Inicio solo en "/", y las demás por su ruta o subrutas', () => {
    expect(isCurrentItem(find('home'), '/')).toBe(true);
    expect(isCurrentItem(find('home'), '/clients')).toBe(false);
    expect(isCurrentItem(find('clients'), '/clients')).toBe(true);
    expect(isCurrentItem(find('inventory'), '/inventory')).toBe(true);
    expect(isCurrentItem(find('team'), '/employees')).toBe(true);
    expect(isCurrentItem(find('appointments'), '/agenda')).toBe(true);
    expect(isCurrentItem(find('booking'), '/booking')).toBe(true);
  });
});
