import { describe, expect, it } from 'vitest';
import { allocateProportionally, buildEmployeeBreakdown, type BreakdownItem, type BreakdownSale } from '../src/cash';

/** Desglose del cierre de caja por empleado: reparto determinista del descuento y conciliación exacta. */
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('reparto proporcional del descuento (mayor residuo)', () => {
  it('cuadra exacto y es proporcional', () => {
    expect(allocateProportionally([30000, 10000], 4000)).toEqual([3000, 1000]);
    expect(allocateProportionally([1, 1, 1], 2)).toEqual([1, 1, 0]); // empate: las primeras líneas
    expect(allocateProportionally([10000, 10000, 10000], 1000)).toEqual([334, 333, 333]);
  });

  it('nunca reparte de más ni deja una parte mayor que su línea', () => {
    for (const [lines, discount] of [
      [[33333, 33333, 33334], 10001],
      [[7, 13, 29, 51], 99],
      [[1, 999999], 500000],
      [[999_999_999, 999_999_999, 3], 1_999_999_000],
    ] as Array<[number[], number]>) {
      const shares = allocateProportionally(lines, discount);
      expect(sum(shares)).toBe(discount);
      shares.forEach((share, i) => expect(share).toBeLessThanOrEqual(lines[i]!));
      shares.forEach((share) => expect(share).toBeGreaterThanOrEqual(0));
    }
  });

  it('sin descuento o sin importe base no reparte nada', () => {
    expect(allocateProportionally([100, 200], 0)).toEqual([0, 0]);
    expect(allocateProportionally([0, 0], 0)).toEqual([0, 0]);
    expect(allocateProportionally([], 500)).toEqual([]);
  });
});

describe('desglose por empleado', () => {
  const names = new Map([
    ['ana', 'Ana'],
    ['luis', 'Luis'],
  ]);
  const sale = (id: string, discount = 0, tip = 0, subtotal = 0): BreakdownSale => ({ id, discount, tip, total: subtotal - discount + tip });
  const line = (saleId: string, kind: 'service' | 'product', name: string, unit: number, quantity: number, employeeId: string | null): BreakdownItem => ({ saleId, kind, name, quantity, total: unit * quantity, employeeId });

  it('cuenta unidades con quantity y agrupa líneas repetidas del mismo servicio', () => {
    const items = [line('s1', 'service', 'Corte', 20000, 3, 'ana'), line('s1', 'service', 'Corte', 20000, 1, 'ana'), line('s1', 'service', 'Barba', 10000, 2, 'ana')];
    const result = buildEmployeeBreakdown([sale('s1', 0, 0, 100000)], items, names);
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0]).toMatchObject({ employeeName: 'Ana', serviceUnits: 6, gross: 100000, discount: 0, net: 100000 });
    expect(result.employees[0]!.services).toEqual([
      { name: 'Corte', units: 4, gross: 80000, discount: 0, net: 80000 },
      { name: 'Barba', units: 2, gross: 20000, discount: 0, net: 20000 },
    ]);
  });

  it('venta compartida por varios empleados con productos: el descuento se reparte una sola vez y todo concilia', () => {
    // Subtotal 70.000: Ana 30.000 + Luis 30.000 + producto 10.000; descuento 7.001 (manual + código + cumpleaños ya sumados).
    const sales = [sale('s1', 7001, 5000, 70000)];
    const items = [line('s1', 'service', 'Corte', 30000, 1, 'ana'), line('s1', 'service', 'Tinte', 30000, 1, 'luis'), line('s1', 'product', 'Champú', 5000, 2, null)];
    const result = buildEmployeeBreakdown(sales, items, names);
    const ana = result.employees.find((e) => e.employeeId === 'ana')!;
    const luis = result.employees.find((e) => e.employeeId === 'luis')!;
    expect(ana.discount + luis.discount + result.unattributed.discount).toBe(7001);
    expect([ana.discount, luis.discount, result.unattributed.discount]).toEqual([3001, 3000, 1000]);
    expect(result.unattributed).toMatchObject({ productUnits: 2, serviceUnits: 0, gross: 10000, net: 9000 });
    expect(result.totals).toEqual({ gross: 70000, discount: 7001, net: 62999, tip: 5000, total: 67999 });
    // Conciliación: netos desglosados = neto del día; neto + propinas = ventas del día. La propina no se atribuye a nadie.
    expect(ana.net + luis.net + result.unattributed.net).toBe(result.totals.net);
    expect(result.totals.net + result.totals.tip).toBe(result.totals.total);
  });

  it('servicios sin profesional quedan sin atribución; un producto nunca se atribuye aunque traiga employeeId', () => {
    const items = [line('s1', 'service', 'Corte', 20000, 1, null), line('s1', 'product', 'Cera', 15000, 1, 'ana')];
    const result = buildEmployeeBreakdown([sale('s1', 0, 0, 35000)], items, names);
    expect(result.employees).toEqual([]);
    expect(result.unattributed).toMatchObject({ serviceUnits: 1, productUnits: 1, gross: 35000, net: 35000 });
  });

  it('varias ventas: la suma de netos concilia exacto con muchos redondeos', () => {
    const sales: BreakdownSale[] = [];
    const items: BreakdownItem[] = [];
    for (let i = 0; i < 25; i++) {
      const lines = [line(`s${i}`, 'service', 'Corte', 13333 + i, 1, 'ana'), line(`s${i}`, 'service', 'Barba', 7777, i % 3 + 1, 'luis'), line(`s${i}`, 'product', 'Gel', 3331, 1, null)];
      const subtotal = sum(lines.map((l) => l.total));
      sales.push(sale(`s${i}`, (i * 997) % subtotal, i * 100, subtotal));
      items.push(...lines);
    }
    const result = buildEmployeeBreakdown(sales, items, names);
    const net = sum(result.employees.map((e) => e.net)) + result.unattributed.net;
    expect(net).toBe(result.totals.net);
    expect(sum(result.employees.map((e) => e.discount)) + result.unattributed.discount).toBe(sum(sales.map((s) => s.discount)));
    expect(result.totals.total).toBe(sum(sales.map((s) => s.total)));
  });

  it('sin ventas: todo en cero, sin empleados inventados', () => {
    expect(buildEmployeeBreakdown([], [], names)).toEqual({
      employees: [],
      unattributed: { serviceUnits: 0, services: [], productUnits: 0, products: [], gross: 0, discount: 0, net: 0 },
      totals: { gross: 0, discount: 0, net: 0, tip: 0, total: 0 },
    });
  });
});
