import { canAny, type Actor, type EmployeePermission } from '@xiro/shared';
import { AppError } from './errors';

/**
 * Política de acceso de TODAS las rutas autenticadas (prefijo /api):
 *  - 'any'   → cualquier persona con sesión (dueño o empleado, sin permisos extra).
 *  - 'owner' → solo el dueño.
 *  - lista   → el dueño, o un empleado con AL MENOS UNO de esos permisos.
 *
 * Es por defecto-denegar: una ruta autenticada sin entrada aquí NO arranca (ver `assertPolicyCovers`), así que
 * no se puede añadir un endpoint y olvidar decidir quién puede llamarlo.
 */
export type PolicyRule = 'any' | 'owner' | readonly EmployeePermission[];

export const POLICY: Record<string, PolicyRule> = {
  // Cuenta propia
  'GET /me': 'any',
  'PATCH /me': 'any',
  'POST /me/phone/request': 'any',
  'POST /me/phone/confirm': 'any',

  // Negocio (leer lo básico es necesario para mostrar la app; cambiarlo, caja y equipo son del dueño)
  'GET /business': 'any',
  'PATCH /business': 'owner',
  'PUT /business/logo': 'owner',
  'GET /cash/today': 'owner',
  'POST /cash/opening': 'owner',

  // Catálogo e inventario
  'GET /categories': ['catalog_view'],
  'POST /categories': ['catalog_manage'],
  'PATCH /categories/:id': ['catalog_manage'],
  'DELETE /categories/:id': ['catalog_manage'],
  'GET /items': ['catalog_view'],
  'GET /items/:id': ['catalog_view'],
  'POST /items': ['catalog_manage'],
  'PUT /items/:id': ['catalog_manage'],
  'POST /items/:id/stock-adjustments': ['catalog_manage'],
  'DELETE /items/:id': ['catalog_manage'],
  'POST /items/:id/photos': ['catalog_manage'],
  'DELETE /items/:id/photos/:photoId': ['catalog_manage'],
  'POST /items/:id/photos/:photoId/primary': ['catalog_manage'],

  // Clientes
  'GET /clients': ['clients_view'],
  'GET /clients/:id': ['clients_view'],
  'POST /clients': ['clients_manage'],
  'PUT /clients/:id': ['clients_manage'],
  'DELETE /clients/:id': ['clients_manage'],

  // Servicios realizados y fidelización (la configuración del programa es del dueño)
  'GET /service-records': ['services_record'],
  'POST /service-records': ['services_record'],
  'GET /loyalty/program': ['services_record', 'loyalty_redeem'],
  'PUT /loyalty/program': 'owner',
  'GET /loyalty/clients': ['loyalty_redeem', 'services_record'],
  'GET /loyalty/redemptions': ['loyalty_redeem'],
  'POST /loyalty/clients/:clientId/redeem': ['loyalty_redeem'],

  // Plan y pagos: el empleado solo ve si hay acceso (respuesta reducida), nada de precios ni método de pago
  'GET /subscription': 'any',
  'POST /subscription/trial': 'owner',
  'POST /subscription/checkout/stripe': 'owner',
  'POST /subscription/checkout/paypal': 'owner',
  'POST /subscription/checkout/bank-transfer': 'owner',
  'POST /subscription/cancel': 'owner',

  // Notificaciones push del negocio (van al dueño)
  'GET /notifications/settings': 'owner',
  'PUT /notifications/settings': 'owner',
  'GET /notifications/vapid-public-key': 'owner',
  'POST /notifications/register': 'owner',
  'DELETE /notifications/register': 'owner',
  'POST /notifications/test': 'owner',

  // Equipo y bitácora
  'GET /employees': 'owner',
  'POST /employees': 'owner',
  'PATCH /employees/:id': 'owner',
  'GET /audit-logs': 'owner',
};

/** `/api/items/:id` → `/items/:id`; HEAD se rige por la política de GET. */
export const policyKey = (method: string, url: string): string => `${method === 'HEAD' ? 'GET' : method} ${url.replace(/^\/api/, '')}`;

export function assertPolicyCovers(method: string, url: string): void {
  if (method === 'HEAD') return;
  if (!(policyKey(method, url) in POLICY)) throw new Error(`Ruta autenticada sin política de acceso: ${policyKey(method, url)} (añádela a POLICY en authz.ts)`);
}

/** Lanza 403 si `actor` no puede llamar a esa ruta. Una ruta desconocida se trata como solo-dueño. */
export function authorize(actor: Actor, method: string, url: string): void {
  if (actor.role === 'owner') return;
  const rule = POLICY[policyKey(method, url)] ?? 'owner';
  if (rule === 'any') return;
  if (rule === 'owner' || !canAny(actor, rule)) throw new AppError(403, 'forbidden');
}
