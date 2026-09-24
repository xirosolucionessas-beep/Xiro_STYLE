/** Roles y permisos. El dueño (owner) puede todo; un empleado solo lo que el dueño le concede, módulo por módulo. */

export const ROLES = ['owner', 'employee'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Permisos que un dueño puede dar a un empleado. Lo que NO aparece aquí es SIEMPRE solo del dueño (datos del negocio,
 * caja, plan y pagos, notificaciones, configuración de fidelización y la gestión de empleados): no hay forma de concederlo.
 */
export const EMPLOYEE_PERMISSIONS = ['clients_view', 'clients_manage', 'catalog_view', 'catalog_manage', 'services_record', 'loyalty_redeem'] as const;
export type EmployeePermission = (typeof EMPLOYEE_PERMISSIONS)[number];

/** Un permiso "mayor" incluye lo que necesita para funcionar (no se puede editar clientes sin poder verlos). */
const IMPLIES: Partial<Record<EmployeePermission, EmployeePermission[]>> = {
  clients_manage: ['clients_view'],
  catalog_manage: ['catalog_view'],
  // Registrar un servicio pide elegir cliente y servicio; canjear un premio pide ver al cliente.
  services_record: ['clients_view', 'catalog_view'],
  loyalty_redeem: ['clients_view'],
};

/** Descarta lo desconocido, quita duplicados, agrega lo implícito y devuelve en el orden canónico. */
export function normalizePermissions(input: readonly string[]): EmployeePermission[] {
  const known = new Set<EmployeePermission>();
  for (const value of input) {
    if (!(EMPLOYEE_PERMISSIONS as readonly string[]).includes(value)) continue;
    const permission = value as EmployeePermission;
    known.add(permission);
    for (const implied of IMPLIES[permission] ?? []) known.add(implied);
  }
  return EMPLOYEE_PERMISSIONS.filter((permission) => known.has(permission));
}

export interface Actor {
  role: Role;
  permissions: readonly EmployeePermission[];
}

export const isOwner = (actor: Pick<Actor, 'role'>): boolean => actor.role === 'owner';

export function can(actor: Actor, permission: EmployeePermission): boolean {
  return actor.role === 'owner' || actor.permissions.includes(permission);
}

export function canAny(actor: Actor, permissions: readonly EmployeePermission[]): boolean {
  return actor.role === 'owner' || permissions.some((permission) => actor.permissions.includes(permission));
}
