import type { Actor } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { meets, routeRequirement } from '../src/lib/access';
import { lowStockList } from '../src/lib/dashboard';
import { lowStock, tracksStock } from '../src/lib/homeMetrics';
import { menuFor } from '../src/lib/menu';

const owner: Actor = { role: 'owner', permissions: [] };
const employee = (...permissions: Actor['permissions'][number][]): Actor => ({ role: 'employee', permissions });

const ids = (actor: Actor) => menuFor(actor).flatMap((s) => s.items.map((i) => i.id));

describe('acceso a Citas, Mi página web y Servicios', () => {
  it('cada ruta nueva exige el permiso correcto (el servidor impone lo mismo)', () => {
    expect(routeRequirement('/agenda')).toEqual(['agenda_own']);
    expect(routeRequirement('/booking')).toEqual(['public_page_manage']);
    expect(routeRequirement('/packages')).toEqual(['catalog_view']);
    expect(routeRequirement('/review-items')).toEqual(['catalog_manage']);
  });

  it('el dueño lo ve todo; un empleado solo lo que se le dio', () => {
    for (const route of ['/agenda', '/booking', '/packages', '/review-items']) expect(meets(owner, routeRequirement(route)), route).toBe(true);
    const none = employee();
    expect(meets(none, routeRequirement('/agenda'))).toBe(false);
    expect(meets(employee('agenda_own'), routeRequirement('/agenda'))).toBe(true);
    expect(meets(employee('agenda_own'), routeRequirement('/booking'))).toBe(false);
    expect(meets(employee('public_page_manage'), routeRequirement('/booking'))).toBe(true);
    expect(meets(employee('catalog_view'), routeRequirement('/review-items'))).toBe(false);
    expect(meets(employee('catalog_manage'), routeRequirement('/review-items'))).toBe(true);
  });

  it('el menú muestra Citas y Mi página web solo a quien corresponde', () => {
    expect(ids(owner)).toEqual(expect.arrayContaining(['appointments', 'booking', 'packages']));
    expect(ids(employee())).not.toContain('appointments');
    expect(ids(employee('agenda_own'))).toContain('appointments');
    expect(ids(employee('agenda_own'))).not.toContain('booking');
    expect(ids(employee('public_page_manage'))).toContain('booking');
    expect(ids(employee('catalog_view'))).toContain('packages');
  });
});

describe('inventario: solo lo que lleva existencias', () => {
  it('los servicios no cuentan; los productos y lo aún sin confirmar sí', () => {
    expect(tracksStock({ kind: 'product', kindConfirmed: true })).toBe(true);
    expect(tracksStock({ kind: 'service', kindConfirmed: true })).toBe(false);
    // Propuesto como servicio (sin existencias) pero el dueño aún no lo confirmó: no desaparece de las alertas.
    expect(tracksStock({ kind: 'service', kindConfirmed: false })).toBe(true);
    // Datos antiguos sin esos campos se tratan como producto (comportamiento de siempre).
    expect(tracksStock({})).toBe(true);
  });

  it('las alertas de stock ignoran los servicios confirmados', () => {
    const items = [
      { id: 'a', name: 'Corte', stock: 0, stockStatus: 'out_of_stock' as const, kind: 'service' as const, kindConfirmed: true },
      { id: 'b', name: 'Cera', stock: 2, stockStatus: 'reorder' as const, kind: 'product' as const, kindConfirmed: true },
      { id: 'c', name: 'Masaje', stock: 0, stockStatus: 'out_of_stock' as const, kind: 'service' as const, kindConfirmed: false },
    ];
    expect(lowStock(items)).toEqual({ count: 2, reorder: 1, outOfStock: 1 });
    expect(lowStockList(items).map((i) => i.id)).toEqual(['c', 'b']);
  });
});
