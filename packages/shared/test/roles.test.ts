import { describe, expect, it } from 'vitest';
import { can, canAny, EMPLOYEE_PERMISSIONS, employeeCreateSchema, employeeUpdateSchema, isOwner, normalizePermissions } from '../src';

describe('normalizePermissions', () => {
  it('descarta lo desconocido y duplicados, y devuelve en orden canónico', () => {
    expect(normalizePermissions(['catalog_view', 'admin', 'catalog_view', 'clients_view'])).toEqual(['clients_view', 'catalog_view']);
  });
  it('agrega lo implícito: gestionar incluye ver; registrar servicios pide clientes y catálogo', () => {
    expect(normalizePermissions(['clients_manage'])).toEqual(['clients_view', 'clients_manage']);
    expect(normalizePermissions(['services_record'])).toEqual(['clients_view', 'catalog_view', 'services_record']);
    expect(normalizePermissions(['loyalty_redeem'])).toEqual(['clients_view', 'loyalty_redeem']);
  });
  it('es idempotente y vacío da vacío', () => {
    const once = normalizePermissions([...EMPLOYEE_PERMISSIONS]);
    expect(normalizePermissions(once)).toEqual(once);
    expect(normalizePermissions([])).toEqual([]);
  });
});

describe('can / canAny / isOwner', () => {
  const employee = { role: 'employee' as const, permissions: ['clients_view' as const] };
  const owner = { role: 'owner' as const, permissions: [] };
  it('el dueño puede todo; el empleado solo lo concedido', () => {
    expect(can(owner, 'catalog_manage')).toBe(true);
    expect(can(employee, 'clients_view')).toBe(true);
    expect(can(employee, 'clients_manage')).toBe(false);
    expect(canAny(employee, ['catalog_view', 'clients_view'])).toBe(true);
    expect(canAny(employee, ['catalog_view'])).toBe(false);
    expect(isOwner(owner)).toBe(true);
    expect(isOwner(employee)).toBe(false);
  });
});

describe('esquemas de empleado', () => {
  it('exige contacto y contraseña fuerte; los permisos son solo los conocidos', () => {
    expect(employeeCreateSchema.safeParse({ name: 'Ana', password: 'Secreta123' }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ name: 'Ana', email: 'ana@correo.com', password: 'debil' }).success).toBe(false);
    expect(employeeCreateSchema.safeParse({ name: 'Ana', email: 'ana@correo.com', password: 'Secreta123', permissions: ['root'] }).success).toBe(false);
    expect(employeeCreateSchema.parse({ name: 'Ana', email: 'ana@correo.com', password: 'Secreta123' }).permissions).toEqual([]);
  });
  it('la actualización es parcial y no acepta un rol', () => {
    expect(employeeUpdateSchema.parse({ active: false })).toEqual({ active: false });
    expect(employeeUpdateSchema.parse({ role: 'owner', name: 'X' })).toEqual({ name: 'X' });
  });
});
