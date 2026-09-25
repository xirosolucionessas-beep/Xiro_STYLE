import { canAny, type Actor, type EmployeePermission } from '@xiro/shared';

/**
 * Quién puede ver cada pantalla. Solo mejora la experiencia (no mostrar lo que igual daría 403): la seguridad real
 * la impone el servidor en CADA petición (apps/api/src/authz.ts). Sin restricción = cualquier persona con sesión.
 */
export type Requirement = 'owner' | readonly EmployeePermission[];

/** Sin actor (sesión aún cargando) no se oculta nada: el guardián actúa cuando ya se sabe quién es. */
export function meets(actor: Actor | null | undefined, requires: Requirement | undefined): boolean {
  if (!requires || !actor) return true;
  if (requires === 'owner') return actor.role === 'owner';
  return canAny(actor, requires);
}

const ROUTES: Array<[pattern: RegExp, requires: Requirement]> = [
  [/^\/inventory$/, ['catalog_view']],
  [/^\/catalog$/, ['catalog_view']],
  [/^\/share$/, ['catalog_view']],
  [/^\/item\/form$/, ['catalog_manage']],
  [/^\/item\/[^/]+$/, ['catalog_view']],
  [/^\/catalog-item\/[^/]+$/, ['catalog_view']],
  [/^\/categories$/, ['catalog_manage']],
  [/^\/clients$/, ['clients_view']],
  [/^\/client\/form$/, ['clients_manage']],
  [/^\/client\/[^/]+$/, ['clients_view']],
  [/^\/loyalty$/, ['loyalty_redeem', 'services_record']],
  [/^\/employees$/, 'owner'],
  [/^\/agenda$/, 'owner'],
  [/^\/reports$/, 'owner'],
  [/^\/business$/, 'owner'],
  [/^\/subscription$/, 'owner'],
  [/^\/cash-opening$/, 'owner'],
];

/** Requisito de una ruta de la app; `undefined` = abierta a cualquier sesión (inicio, Ajustes, perfil). */
export function routeRequirement(pathname: string): Requirement | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return ROUTES.find(([pattern]) => pattern.test(path))?.[1];
}

/** Adapta el usuario de la sesión al `Actor` de @xiro/shared. */
export const actorOf = (user: { role: Actor['role']; permissions: Actor['permissions'] } | null | undefined): Actor | null => (user ? { role: user.role, permissions: user.permissions } : null);
