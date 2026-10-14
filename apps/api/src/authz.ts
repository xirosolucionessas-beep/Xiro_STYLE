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
  'PUT /me/photo': 'any',
  'DELETE /me/photo': 'any',
  'POST /me/phone/request': 'any',
  'POST /me/phone/confirm': 'any',

  // Mensajes: chat interno entre personas del mismo negocio, cada quien ve y escribe solo lo suyo.
  'GET /messages/people': 'any',
  'GET /messages/conversations': 'any',
  'POST /messages/conversations': 'any',
  'GET /messages/conversations/:id/messages': 'any',
  'POST /messages/conversations/:id/messages': 'any',
  'POST /messages/conversations/:id/read': 'any',

  // Negocio (leer lo básico es necesario para mostrar la app; cambiarlo, caja y equipo son del dueño)
  'GET /business': 'any',
  'PATCH /business': 'owner',
  'PUT /business/logo': 'owner',
  'GET /cash/today': 'owner',
  'GET /cash/openings': 'owner',
  'POST /cash/opening': 'owner',
  // Gastos (módulo Finanzas): el dueño o un empleado con el permiso "finance".
  'GET /expenses': ['finance'],
  'GET /expenses/payees': ['finance'],
  'GET /expenses/:id': ['finance'],
  'POST /expenses': ['finance'],
  'PUT /expenses/:id': ['finance'],
  'POST /expenses/:id/void': ['finance'],
  // Balance general (Reportes): las mismas reglas que Gastos.
  'GET /reports/balance': ['finance'],
  'GET /reports/balance/movements': ['finance'],
  'GET /reports/balance/export.pdf': ['finance'],
  'GET /reports/balance/export.xlsx': ['finance'],
  'GET /expenses/export.xlsx': ['finance'],
  'GET /expenses/page': ['finance'],
  'GET /cash/close-summary': 'owner',
  'GET /cash/closings': 'owner',
  'GET /cash/closings/:id': 'owner',
  'POST /cash/close': 'owner',
  'POST /cash/closings/:id/void': 'owner',

  // Catálogo e inventario
  'GET /categories': ['catalog_view'],
  'POST /categories': ['catalog_manage'],
  'PATCH /categories/:id': ['catalog_manage'],
  'DELETE /categories/:id': ['catalog_manage'],
  'GET /items': ['catalog_view'],
  'GET /items/summary': ['catalog_view'],
  'GET /items/:id': ['catalog_view'],
  'POST /items': ['catalog_manage'],
  'PUT /items/:id': ['catalog_manage'],
  'POST /items/bulk-publish': ['catalog_manage'],
  'POST /items/:id/stock-adjustments': ['catalog_manage'],
  'DELETE /items/:id': ['catalog_manage'],
  'POST /items/:id/photos': ['catalog_manage'],
  'DELETE /items/:id/photos/:photoId': ['catalog_manage'],
  'POST /items/:id/photos/:photoId/primary': ['catalog_manage'],

  // Clientes
  'GET /clients': ['clients_view'],
  'GET /clients/summary': ['clients_view'],
  'GET /clients/:id': ['clients_view'],
  'POST /clients': ['clients_manage'],
  'PUT /clients/:id': ['clients_manage'],
  'DELETE /clients/:id': ['clients_manage'],
  'PUT /clients/:id/photo': ['clients_manage'],
  'DELETE /clients/:id/photo': ['clients_manage'],
  'POST /clients/:id/anonymize': ['clients_manage'],
  // Restablecer la contraseña de la cuenta en línea de un cliente: solo el dueño (8.10 del encargo).
  'POST /clients/:id/reset-password': 'owner',

  // Ventas (POS): registrar y consultar piden el mismo permiso que registrar un servicio; anular es solo del dueño.
  'GET /sales': ['services_record'],
  'GET /sales/:id': ['services_record'],
  'POST /sales': ['services_record'],
  'POST /sales/:id/void': 'owner',

  // Pedidos de productos de la página pública: los atiende quien registra ventas (entregar = registrar la venta).
  'GET /orders': ['services_record'],
  'GET /orders/summary': ['services_record'],
  'GET /orders/:id': ['services_record'],
  'POST /orders/:id/ready': ['services_record'],
  'POST /orders/:id/cancel': ['services_record'],

  // Códigos de descuento de la página pública (Fase 4): los gestiona quien gestiona la página.
  'GET /discount-codes': ['public_page_manage'],
  'POST /discount-codes': ['public_page_manage'],
  'PUT /discount-codes/:id': ['public_page_manage'],
  'DELETE /discount-codes/:id': ['public_page_manage'],
  // Lista de espera: ver a TODA la gente que espera es de quien ve la agenda completa o gestiona la página (donde se activa).
  'GET /waitlist': ['agenda_all', 'public_page_manage'],
  'POST /waitlist/:id/cancel': ['agenda_all', 'public_page_manage'],

  // Servicios realizados y fidelización (la configuración del programa es del dueño)
  'GET /service-records': ['services_record'],
  'GET /service-records/summary': ['services_record'],
  'GET /service-records/by-client': ['services_record'],
  'POST /service-records': ['services_record'],
  'GET /loyalty/program': ['services_record', 'loyalty_redeem'],
  'PUT /loyalty/program': 'owner',
  'GET /loyalty/clients': ['loyalty_redeem', 'services_record'],
  'GET /loyalty/summary': ['loyalty_redeem', 'services_record'],
  'GET /loyalty/redemptions': ['loyalty_redeem'],
  'POST /loyalty/clients/:clientId/redeem': ['loyalty_redeem'],

  // Plan y pagos: el empleado solo ve si hay acceso (respuesta reducida), nada de precios ni método de pago
  'GET /subscription': 'any',
  'POST /subscription/trial': 'owner',
  'POST /subscription/checkout/stripe': 'owner',
  'POST /subscription/checkout/paypal': 'owner',
  'POST /subscription/checkout/bank-transfer': 'owner',
  'POST /subscription/cancel': 'owner',
  'GET /subscription/invoices': 'owner',

  // Notificaciones push: las preferencias del negocio son del dueño, pero cada persona (también los empleados, para recibir avisos de
  // sus citas) registra y da de baja SUS propios dispositivos. Los avisos de negocio (premios, facturación) siguen yendo solo al dueño.
  'GET /notifications/settings': 'owner',
  'PUT /notifications/settings': 'owner',
  'GET /notifications/vapid-public-key': 'any',
  'POST /notifications/register': 'any',
  'DELETE /notifications/register': 'any',
  'POST /notifications/test': 'any',
  // Centro de notificaciones: cada quien lee/marca solo LAS SUYAS (lo aplica la ruta, acotando siempre por request.user.sub).
  'GET /notifications': 'any',
  'POST /notifications/:id/read': 'any',
  'POST /notifications/read-all': 'any',

  // Agenda: sin "ver todas las agendas" un empleado solo ve y toca las citas donde él es el profesional (lo aplica la ruta)
  'GET /appointments': ['agenda_own'],
  'GET /appointments/:id': ['agenda_own'],
  'POST /booking/events/ticket': ['agenda_own'],
  'POST /appointments': ['appointments_manage'],
  'PATCH /appointments/:id': ['appointments_manage'],
  'POST /appointments/:id/status': ['appointments_manage'],
  'GET /booking/availability': ['appointments_manage'],
  'GET /booking/days': ['appointments_manage'],
  'GET /professionals': ['appointments_manage', 'agenda_all', 'public_page_manage'],
  'PATCH /professionals/:id': ['public_page_manage'],
  'PUT /professionals/:id/photo': ['public_page_manage'],
  'DELETE /professionals/:id/photo': ['public_page_manage'],
  'PUT /professionals/:id/schedule': ['public_page_manage'],
  'PUT /professionals/:id/services': ['public_page_manage'],
  'GET /professionals/:id/time-off': ['agenda_own'],
  'POST /professionals/:id/time-off': ['agenda_own'],
  'DELETE /time-off/:id': ['agenda_own'],

  // Servicios: estilos, paquetes y revisión servicio/producto (mismo permiso que el catálogo)
  'GET /items/classification': ['catalog_manage'],
  'POST /items/classification': ['catalog_manage'],
  'GET /items/:id/variants': ['catalog_view'],
  'POST /items/:id/variants': ['catalog_manage'],
  'PUT /variants/:id': ['catalog_manage'],
  'DELETE /variants/:id': ['catalog_manage'],
  'GET /packages': ['catalog_view'],
  'POST /packages': ['catalog_manage'],
  'PUT /packages/:id': ['catalog_manage'],
  'DELETE /packages/:id': ['catalog_manage'],

  // Página pública de reservas: por defecto solo el dueño (los empleados no tienen este permiso salvo que se les dé)
  'GET /booking/settings': ['public_page_manage'],
  'PUT /booking/settings': ['public_page_manage'],
  'PUT /booking/profile': ['public_page_manage'],
  'PUT /booking/profile/cover': ['public_page_manage'],
  'DELETE /booking/profile/cover': ['public_page_manage'],
  'POST /booking/profile/gallery': ['public_page_manage'],
  'DELETE /booking/profile/gallery/:file': ['public_page_manage'],
  'GET /booking/slug/check': ['public_page_manage'],
  'PUT /booking/slug': ['public_page_manage'],
  'GET /booking/closures': ['public_page_manage'],
  'POST /booking/closures': ['public_page_manage'],
  'DELETE /booking/closures/:id': ['public_page_manage'],
  'GET /booking/places/config': ['public_page_manage'],
  'GET /booking/places/autocomplete': ['public_page_manage'],
  'GET /booking/places/details': ['public_page_manage'],
  'GET /booking/places/reverse': ['public_page_manage'],
  'GET /booking/places/static-map': ['public_page_manage'],
  'GET /booking/reviews': ['public_page_manage'],
  'PATCH /booking/reviews/:id': ['public_page_manage'],

  // Equipo y bitácora
  'GET /employees': 'owner',
  'POST /employees': 'owner',
  'PATCH /employees/:id': 'owner',
  'PUT /employees/:id/photo': 'owner',
  'DELETE /employees/:id/photo': 'owner',
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
