import { assistantAnswerText, classifyAssistantQuestion, imageMatchResultText, matchAssistantPeriod, translate, type AssistantQuestionKey, type Language } from '@xiro/shared';

/**
 * Asistente de negocio (sección 4C) — servicio ÚNICO que usa el panel.
 *
 * El backend YA EXISTE (catálogo cerrado, `GET /api/assistant/{catalog,ask}`). El texto libre se clasifica contra
 * ese catálogo por palabras clave (Fase D: `classifyAssistantQuestion` en `@xiro/shared` — sin IA, determinista, sin
 * red ni acceso a datos: solo decide cuál `AssistantQuestionKey` coincide, si alguna). Si no reconoce nada, o si
 * coincide con MÁS de una pregunta (ambiguo: nunca se adivina cuál), lo dice y el panel ofrece "Ver todas las
 * preguntas" en vez de inventar o ejecutar al azar.
 *
 * Adjuntos: una foto de un producto se compara LOCALMENTE contra el inventario (`POST /api/assistant/image-match`,
 * ver `apps/api/src/assistant/imageMatch.ts`) — nunca sale hacia un servicio externo de IA. Una nota de voz todavía
 * no se transcribe (decisión explícita del negocio): se pide amablemente escribir la consulta en su lugar.
 *
 * Nunca se llama a una API de IA externa desde el navegador: siempre a la API de Xiro, que ya conoce el negocio de
 * la cuenta activa y vuelve a exigir el permiso real de la pregunta — este clasificador no concede ni adelanta ninguno.
 */

export const ASSISTANT_BACKEND_READY = true;

export interface AssistantAttachmentInput {
  kind: 'image' | 'audio';
  blob: Blob;
  name: string;
}

export interface AssistantRequest {
  text: string;
  attachments: AssistantAttachmentInput[];
  language: Language;
}

export type AssistantAskResult =
  | { ok: true; reply: string }
  | { ok: false; reason: 'unavailable' | 'network' }
  /** El texto no coincide con ninguna pregunta del catálogo: el panel debe decirlo y ofrecer el catálogo completo. */
  | { ok: false; reason: 'not_understood' }
  /** El texto coincide con más de una pregunta del catálogo: el panel debe mostrar las candidatas, nunca elegir una sola. */
  | { ok: false; reason: 'ambiguous'; candidates: AssistantQuestionKey[] }
  /** Nota de voz adjunta: sin transcripción todavía, se pide escribir o repetir la consulta (ver la propuesta). */
  | { ok: false; reason: 'audio_unsupported' }
  /** La cuenta no tiene el permiso de esa pregunta (el servidor lo exige igual; esto es solo para el mensaje). */
  | { ok: false; reason: 'no_access' };

export async function askAssistant(request: AssistantRequest): Promise<AssistantAskResult> {
  if (!ASSISTANT_BACKEND_READY) return { ok: false, reason: 'unavailable' };
  // Si hay una nota de voz, no hay transcripción que usar — no se intenta responder con el texto escrito aparte,
  // para no dar la impresión de que SÍ se escuchó el audio.
  if (request.attachments.some((attachment) => attachment.kind === 'audio')) return { ok: false, reason: 'audio_unsupported' };

  const image = request.attachments.find((attachment) => attachment.kind === 'image');
  if (image) {
    // Import diferido: ver la nota junto al mismo patrón más abajo (no cargar React Native en las pruebas de la capa web).
    const { api, ApiError } = await import('@/lib/api');
    try {
      const form = new FormData();
      form.append('photo', image.blob, image.name || 'foto.jpg');
      const result = await api.assistantImageMatch(form);
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
  // Import diferido: `lib/api.ts` importa `react-native` (para `Platform`), que el entorno de pruebas de la capa web
  // no carga a propósito (ver vitest.config.mts). Cargarlo solo aquí, al llamar de verdad, mantiene esta función
  // 100% real sin arrastrar React Native a las pruebas que nunca llegan a ejecutar esta rama (texto no reconocido).
  const { api, ApiError } = await import('@/lib/api');
  try {
    const answer = await api.assistantAsk({ question: classified.question, period });
    return { ok: true, reply: assistantAnswerText(answer, (key) => translate(request.language, key)) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { ok: false, reason: 'no_access' };
    return { ok: false, reason: 'network' };
  }
}
