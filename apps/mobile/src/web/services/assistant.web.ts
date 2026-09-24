/**
 * Asistente de negocio (sección 4C) — servicio ÚNICO que usa el panel.
 *
 * ESTADO: ni la API ni la app móvil tienen hoy un asistente de negocio (no existe el endpoint ni el prompt del
 * sistema que la sección 4C pide reutilizar). Por eso `ASSISTANT_BACKEND_READY` es `false`: la interfaz está completa
 * (adjuntos, cámara, audio, borrador, estados), pero al enviar se responde con un aviso honesto en vez de inventar
 * una respuesta. Cuando exista el backend real (ver la propuesta entregada con esta fase), basta con implementar
 * `askAssistant` de verdad y poner la bandera en `true`; el panel no cambia.
 *
 * Nunca se llama a una API de IA externa desde el navegador, y nada de esto se guarda en disco: `askAssistant`
 * no hace ninguna petición de red mientras `ASSISTANT_BACKEND_READY` sea `false`.
 */

export const ASSISTANT_BACKEND_READY = false;

export interface AssistantAttachmentInput {
  kind: 'image' | 'audio';
  blob: Blob;
  name: string;
}

export interface AssistantRequest {
  text: string;
  attachments: AssistantAttachmentInput[];
}

export type AssistantAskResult = { ok: true; reply: string } | { ok: false; reason: 'unavailable' | 'network' };

/**
 * Punto de integración único. Con el backend listo, aquí iría la petición real (nunca a una API de IA de terceros
 * directamente desde el navegador: siempre a través de la API de Xiro, que ya conoce el negocio de la cuenta activa).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma ya lleva la petición real para cuando exista el backend.
export async function askAssistant(request: AssistantRequest): Promise<AssistantAskResult> {
  if (!ASSISTANT_BACKEND_READY) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'network' };
}
