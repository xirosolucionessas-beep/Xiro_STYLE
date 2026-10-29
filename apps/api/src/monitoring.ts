import type { ErrorEvent } from '@sentry/node';
import type { ObservabilityConfig } from './config';
import { redactUrl } from './logging';

/**
 * Monitoreo de errores con Sentry (Fase 4), OPCIONAL: sin SENTRY_DSN no se carga ni el SDK y todo es un no-op.
 *
 * Solo errores (sin trazas de rendimiento ni instrumentación automática: menos memoria y ningún dato de peticiones que
 * no hayamos elegido). Nada personal sale del servidor: sin cuerpos, cookies, cabeceras de sesión ni IP; las URLs con
 * tokens (enlaces de citas, tickets) se redactan igual que en los logs; del usuario solo viajan los ids.
 */
type SentryModule = typeof import('@sentry/node');
let sentry: SentryModule | null = null;

export interface ErrorContext {
  requestId?: string;
  method?: string;
  /** Plantilla de la ruta (`/api/clients/:id`), nunca la URL con datos. */
  route?: string;
  userId?: string;
  businessId?: string;
  /** Origen fuera de una petición: trabajos, arranque, `uncaughtException`… */
  source?: string;
}

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-admin-secret', 'stripe-signature', 'paypal-transmission-sig', 'x-xiro-session']);

/** Limpia un evento antes de enviarlo (se exporta para probarlo). */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = redactUrl(event.request.url);
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) if (SENSITIVE_HEADERS.has(name.toLowerCase())) delete event.request.headers[name];
    }
  }
  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : {};
  delete event.server_name; // nombre del host del contenedor: no aporta y describe la infraestructura
  return event;
}

export async function initMonitoring(config: ObservabilityConfig): Promise<boolean> {
  if (!config.sentryDsn) return false;
  sentry = await import('@sentry/node');
  sentry.init({
    dsn: config.sentryDsn,
    environment: config.sentryEnvironment,
    ...(config.release ? { release: config.release } : {}),
    // Nada de datos de la persona: ni usuario automático, cookies, cabeceras, cuerpos ni parámetros de la URL.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    defaultIntegrations: false,
    beforeSend: (event) => scrubEvent(event),
  });
  return true;
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  const client = sentry;
  if (!client) return;
  client.withScope((scope) => {
    if (context.requestId) scope.setTag('request_id', context.requestId);
    if (context.method) scope.setTag('method', context.method);
    if (context.route) scope.setTag('route', context.route);
    if (context.businessId) scope.setTag('business_id', context.businessId);
    if (context.source) scope.setTag('source', context.source);
    if (context.userId) scope.setUser({ id: context.userId });
    client.captureException(error);
  });
}

/** Envía lo pendiente antes de salir (cierre ordenado o error fatal). */
export async function flushMonitoring(timeoutMs = 2_000): Promise<void> {
  await sentry?.flush(timeoutMs).catch(() => undefined);
}
