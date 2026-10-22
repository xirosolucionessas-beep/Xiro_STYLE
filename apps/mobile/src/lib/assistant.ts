import { assistantAnswerText, classifyAssistantQuestion, imageMatchResultText, matchAssistantPeriod, translate, type AssistantQuestionKey, type Language } from '@xiro/shared';
import { ApiError, api } from './api';

/**
 * Asistente de negocio en Android/iOS — mismo contrato que el de la web (`web/services/assistant.web.ts`).
 *
 * El backend YA EXISTE (catálogo cerrado, `GET /api/assistant/{catalog,ask}` — ver `apps/api/src/routes/assistant.ts`).
 * El texto libre se clasifica contra ese catálogo CERRADO por palabras clave (Fase D: `classifyAssistantQuestion`,
 * sin IA, determinista, sin red ni acceso a datos — solo decide cuál `AssistantQuestionKey` coincide, si alguna). Si
 * no reconoce nada, o si coincide con MÁS de una pregunta (ambiguo: nunca se adivina cuál), lo dice y la interfaz
 * ofrece "Ver todas las preguntas" (ver `ui/home/AssistantCatalog.tsx`) en vez de inventar o ejecutar al azar.
 *
 * Foto de un producto: se compara LOCALMENTE contra el inventario (`POST /api/assistant/image-match`, ver
 * `apps/api/src/assistant/imageMatch.ts`) — nunca sale hacia un servicio externo de IA. Nota de voz: sin
 * transcripción (decisión del negocio, por costo); el chat nativo no ofrece grabar audio por esta misma razón.
 *
 * Nunca se llama a un proveedor de IA ni se manda nada a otro sitio: siempre a la API de Xiro, que vuelve a exigir el
 * permiso real de la pregunta — este clasificador no concede ni adelanta ningún permiso.
 */

export const ASSISTANT_BACKEND_READY = true;

export interface AssistantRequest {
  text: string;
  language: Language;
  /** Foto de un producto, ya lista para subir (ver `lib/images.ts#uploadableImage`). Si viene, se compara contra el
   * inventario en vez de interpretar `text` como una pregunta del catálogo (igual prioridad que en la web). */
  imageForm?: FormData;
}

export type AssistantAskResult =
  | { ok: true; reply: string }
  | { ok: false; reason: 'unavailable' | 'network' }
  /** El texto no coincide con ninguna pregunta del catálogo: la interfaz debe decirlo y ofrecer el catálogo completo. */
  | { ok: false; reason: 'not_understood' }
  /** El texto coincide con más de una pregunta del catálogo: la interfaz debe mostrar las candidatas, nunca elegir una sola. */
  | { ok: false; reason: 'ambiguous'; candidates: AssistantQuestionKey[] }
  /** La cuenta no tiene el permiso de esa pregunta (el servidor lo exige igual; esto es solo para el mensaje). */
  | { ok: false; reason: 'no_access' };

export async function askAssistant(request: AssistantRequest): Promise<AssistantAskResult> {
  if (!ASSISTANT_BACKEND_READY) return { ok: false, reason: 'unavailable' };

  if (request.imageForm) {
    try {
      const result = await api.assistantImageMatch(request.imageForm);
      return { ok: true, reply: imageMatchResultText(result, (key) => translate(request.language, key)) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) return { ok: false, reason: 'no_access' };
      return { ok: false, reason: 'network' };
    }
  }

  const classified = classifyAssistantQuestion(request.text, request.language);
  if (classified.kind === 'unsupported') return { ok: false, reason: 'not_understood' };
  if (classified.kind === 'ambiguous') return { ok: false, reason: 'ambiguous', candidates: classified.candidates };
  const period = matchAssistantPeriod(request.text, request.language) ?? undefined;
  try {
    const answer = await api.assistantAsk({ question: classified.question, period });
    return { ok: true, reply: assistantAnswerText(answer, (key) => translate(request.language, key)) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { ok: false, reason: 'no_access' };
    return { ok: false, reason: 'network' };
  }
}
