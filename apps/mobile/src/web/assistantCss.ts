import { font } from './tokens';

/** CSS del asistente de negocio (sección 4C) y su botón flotante. Se añade a buildCss(). */
export function buildAssistantCss(): string {
  return `
/* ---------- Botón flotante ---------- */
.xw-fab--assistant { background: var(--xw-accent); color: var(--xw-on-accent); border: 0; cursor: pointer; }

/* ---------- Panel ---------- */
.xw-asst-root { position: fixed; inset: 0; z-index: 9200; pointer-events: none; }
.xw-asst-root.is-closed { display: none; }
.xw-asst-scrim { position: fixed; inset: 0; background: var(--xw-overlay); pointer-events: auto; }
.xw-asst-panel { position: fixed; z-index: 1; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; pointer-events: auto;
  background: var(--xw-surface); color: var(--xw-text); font-family: var(--xw-font);
  box-shadow: 0 -12px 32px -16px rgba(0, 0, 0, .5), 0 24px 48px -24px rgba(0, 0, 0, .5); }
.xw-asst-panel:focus { outline: none; }

/* ---------- Encabezado ---------- */
.xw-asst-head { flex: none; display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; padding: var(--xw-space-4);
  background: var(--xw-surface-alt); color: var(--xw-text); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-asst-head-ic { flex: none; display: flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem; border-radius: 50%; background: var(--xw-accent-tint); color: var(--xw-accent); }
.xw-asst-head-text { flex: 1; min-width: 0; }
.xw-asst-head-title { margin: 0; font: ${font.weight.bold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-asst-head-sub { margin: 2px 0 0; color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-asst-head-close { flex: none; display: flex; align-items: center; justify-content: center; width: var(--xw-touch); height: var(--xw-touch); border-radius: 50%;
  background: transparent; color: var(--xw-text-muted); border: 0; cursor: pointer; }
.xw-asst-head-close:hover { background: var(--xw-surface); color: var(--xw-text); }

/* ---------- Cuerpo (mensajes) ---------- */
.xw-asst-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--xw-space-3); box-sizing: border-box; padding: var(--xw-space-4); background: var(--xw-background); }
.xw-asst-msg { max-width: 84%; box-sizing: border-box; padding: var(--xw-space-3) var(--xw-space-4); border-radius: var(--xw-radius-lg); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-asst-msg p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.xw-asst-msg p + p { margin-top: var(--xw-space-2); }
.xw-asst-msg.is-bot { align-self: flex-start; background: var(--xw-surface); color: var(--xw-text); border: 1px solid var(--xw-border-subtle); border-bottom-left-radius: var(--xw-radius-sm); }
.xw-asst-msg.is-user { align-self: flex-end; background: var(--xw-accent); color: var(--xw-on-accent); border-bottom-right-radius: var(--xw-radius-sm); }
.xw-asst-msg-img { display: block; max-width: 100%; border-radius: var(--xw-radius-md); margin-bottom: var(--xw-space-2); }
.xw-asst-msg-audio { display: block; width: 100%; max-width: 15rem; height: 2.25rem; margin-bottom: var(--xw-space-2); border-radius: var(--xw-radius-md); overflow: hidden; }

.xw-asst-typing { display: flex; align-items: center; gap: 5px; padding: var(--xw-space-3) var(--xw-space-4); }
.xw-asst-typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--xw-text-muted); animation: xw-asst-bounce 1.1s ease-in-out infinite; }
.xw-asst-typing span:nth-child(2) { animation-delay: .15s; }
.xw-asst-typing span:nth-child(3) { animation-delay: .3s; }
@keyframes xw-asst-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }

.xw-asst-error { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: var(--xw-space-2) var(--xw-space-3); box-sizing: border-box; padding: var(--xw-space-2) var(--xw-space-4);
  background: color-mix(in srgb, var(--xw-danger) 12%, var(--xw-surface)); color: var(--xw-danger); font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }

/* ---------- Zona de entrada ---------- */
.xw-asst-input { flex: none; box-sizing: border-box; padding: var(--xw-space-3) var(--xw-space-4); border-top: 1px solid var(--xw-border-subtle); background: var(--xw-surface); }
.xw-asst-attachments { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); margin-bottom: var(--xw-space-2); }
.xw-asst-attachment { position: relative; display: flex; align-items: center; max-width: 100%; }
.xw-asst-attachment img { width: 3.5rem; height: 3.5rem; object-fit: cover; border-radius: var(--xw-radius-md); border: 1px solid var(--xw-border-subtle); }
/* Contenedor de ancho fijo con overflow:hidden: el control nativo <audio> no siempre respeta max-width por sí solo
   (algunos navegadores no lo encogen bajo su ancho mínimo), así que se fuerza a caber recortando, nunca desbordando. */
.xw-asst-attachment:has(audio) { box-sizing: border-box; width: 11rem; max-width: 100%; height: 2.5rem; border-radius: var(--xw-radius-md); overflow: hidden; background: var(--xw-surface-alt); border: 1px solid var(--xw-border-subtle); }
.xw-asst-attachment audio { display: block; width: 100%; height: 100%; }
.xw-asst-attachment-remove { position: absolute; top: -6px; right: -6px; display: flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; border-radius: 50%;
  background: var(--xw-danger); color: #fff; border: 2px solid var(--xw-surface); cursor: pointer; }

.xw-asst-row1 { display: flex; align-items: flex-end; gap: var(--xw-space-2); }
.xw-asst-textarea { flex: 1; min-width: 0; box-sizing: border-box; min-height: var(--xw-touch); max-height: 7rem; padding: var(--xw-space-2) var(--xw-space-3); resize: none; overflow-y: auto;
  background: var(--xw-background); color: var(--xw-text); border: 2px solid var(--xw-border); border-radius: var(--xw-radius-lg); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font);
  transition: height var(--xw-fast) ease, border-color var(--xw-fast);
  /* Sin flechas del scrollbar nativo del sistema: una barra delgada, discreta, sin botones. */
  scrollbar-width: thin; scrollbar-color: var(--xw-border) transparent; }
.xw-asst-textarea:focus-visible { border-color: var(--xw-focus); }
.xw-asst-textarea::placeholder { color: var(--xw-text-muted); }
.xw-asst-textarea::-webkit-scrollbar { width: 6px; }
.xw-asst-textarea::-webkit-scrollbar-track { background: transparent; }
.xw-asst-textarea::-webkit-scrollbar-thumb { background: var(--xw-border); border-radius: var(--xw-radius-pill); }
.xw-asst-textarea::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
.xw-asst-sqbtn { flex: none; display: flex; align-items: center; justify-content: center; width: var(--xw-touch); height: var(--xw-touch); border-radius: var(--xw-radius-md);
  background: var(--xw-accent-tint); color: var(--xw-accent); border: 0; cursor: pointer; }
.xw-asst-sqbtn:hover { filter: brightness(1.06); }

.xw-asst-row2 { display: flex; align-items: center; justify-content: space-between; margin-top: var(--xw-space-2); }
.xw-asst-mic { display: flex; align-items: center; justify-content: center; width: var(--xw-touch); height: var(--xw-touch); border-radius: 50%; background: transparent; color: var(--xw-accent); border: 0; cursor: pointer; }
.xw-asst-mic:hover { background: var(--xw-accent-tint); }
.xw-asst-send { display: flex; align-items: center; justify-content: center; width: var(--xw-touch); height: var(--xw-touch); border-radius: 50%;
  background: var(--xw-accent); color: var(--xw-on-accent); border: 0; cursor: pointer; transition: opacity var(--xw-fast); }
.xw-asst-send[disabled] { background: var(--xw-border); color: var(--xw-text-muted); cursor: not-allowed; }

.xw-asst-recording { display: flex; align-items: center; flex-wrap: wrap; gap: var(--xw-space-2) var(--xw-space-3); min-height: var(--xw-touch); }
.xw-asst-rec-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--xw-danger); animation: xw-asst-pulse 1.4s ease-in-out infinite; }
@keyframes xw-asst-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.xw-asst-rec-label { flex: 1 1 auto; min-width: 0; font: ${font.weight.semibold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-asst-rec-time { flex: none; color: var(--xw-text-muted); font-variant-numeric: tabular-nums; font: ${font.weight.bold} var(--xw-text-sm)/${font.lineHeight.tight} var(--xw-font); }
.xw-asst-rec-actions { flex: none; display: flex; gap: var(--xw-space-2); width: 100%; }

.xw-asst-footer { flex: none; margin: 0; box-sizing: border-box; padding: var(--xw-space-2) var(--xw-space-4); color: var(--xw-text-muted); font: var(--xw-text-xs)/${font.lineHeight.normal} var(--xw-font);
  border-top: 1px solid var(--xw-border-subtle); overflow-wrap: anywhere; }

/* Móvil: hoja inferior casi a pantalla completa con fondo atenuado detrás. */
@media (max-width: 639px) {
  .xw-asst-panel { left: 0; right: 0; bottom: 0; width: 100%; max-height: 92vh; border-radius: 28px 28px 0 0; animation: xw-asst-sheet var(--xw-base) ease-out; }
  @keyframes xw-asst-sheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
}

/* Escritorio/tableta: drawer flotante anclado, compacto (no debe sentirse como que "toma" el dashboard) y sin fondo
   atenuado (no bloquea el resto de la pantalla). */
@media (min-width: 640px) {
  .xw-asst-scrim { display: none; }
  .xw-asst-panel { right: var(--xw-space-4); bottom: calc(var(--xw-space-4) * 2 + 56px * 2 + 12px + var(--xw-space-2));
    width: 24rem; max-width: calc(100vw - var(--xw-space-4) * 2); height: 34rem; max-height: 75vh; border-radius: var(--xw-radius-xl);
    border: 1px solid var(--xw-border-subtle); box-shadow: 0 20px 45px -18px rgba(0, 0, 0, .55); }
  .xw-asst-panel { animation: xw-asst-float var(--xw-base) ease-out; }
  @keyframes xw-asst-float { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
}

@media (prefers-reduced-motion: reduce) {
  .xw-asst-panel, .xw-asst-rec-dot, .xw-asst-typing span { animation: none !important; }
}
`.trim();
}
