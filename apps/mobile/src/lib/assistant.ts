/**
 * Asistente de negocio en Android/iOS — mismo contrato que el de la web (`web/services/assistant.web.ts`).
 *
 * ESTADO: la API todavía no tiene el endpoint de chat (en `apps/api/src/assistant` solo existe la capa de datos de
 * reportes). Mientras `ASSISTANT_BACKEND_READY` sea `false`, `askAssistant` no hace ninguna petición de red y responde
 * "no disponible": el chat lo muestra como un aviso honesto en vez de inventar una respuesta. Cuando exista el
 * endpoint, basta con implementar la petición aquí (siempre a la API de Xiro, nunca a un proveedor de IA directo desde
 * el teléfono) y poner la bandera en `true`; la interfaz no cambia.
 */

export const ASSISTANT_BACKEND_READY = false;

export interface AssistantRequest {
  text: string;
}

export type AssistantAskResult = { ok: true; reply: string } | { ok: false; reason: 'unavailable' | 'network' };

export async function askAssistant(_request: AssistantRequest): Promise<AssistantAskResult> {
  if (!ASSISTANT_BACKEND_READY) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'network' };
}
