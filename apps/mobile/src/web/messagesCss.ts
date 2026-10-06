import { font } from './tokens';

/** CSS de "Mensajes" (chat interno del equipo): lista + hilo en ancho, una vista a la vez en angosto. Se añade a buildCss(). */
export function buildMessagesCss(): string {
  return `
.xw-msg { container-type: inline-size; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--xw-space-4); min-height: 60vh; }
@container (min-width: 52rem) {
  .xw-msg { grid-template-columns: 320px minmax(0, 1fr); align-items: start; height: calc(100vh - 220px); min-height: 32rem; }
}

.xw-msg-list { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); background: var(--xw-surface); overflow: hidden; }
@container (min-width: 52rem) { .xw-msg-list { height: 100%; } }
.xw-msg-list-head { display: flex; align-items: center; justify-content: space-between; padding: var(--xw-space-3) var(--xw-space-4); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-msg-list-title { margin: 0; font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-msg-people { padding: var(--xw-space-3) var(--xw-space-4); border-bottom: 1px solid var(--xw-border-subtle); display: flex; flex-direction: column; gap: var(--xw-space-1); }
.xw-msg-conv-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }

.xw-msg-row { display: flex; align-items: center; gap: var(--xw-space-3); width: 100%; box-sizing: border-box; min-height: var(--xw-touch); padding: var(--xw-space-3) var(--xw-space-4); color: var(--xw-text); text-align: left; background: none; border: 0; border-bottom: 1px solid var(--xw-border-subtle); cursor: pointer; font-family: var(--xw-font); }
.xw-msg-row:hover, .xw-msg-row.is-active { background: var(--xw-surface-alt); }
.xw-msg-row[data-unread='true'] { background: var(--xw-accent-tint); }
.xw-msg-row .xw-notif-text { flex: 1; min-width: 0; }
.xw-msg-row-meta { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.xw-msg-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: var(--xw-radius-pill); background: var(--xw-accent); color: var(--xw-on-accent); font: ${font.weight.extrabold} 11px/1 var(--xw-font); }

.xw-msg-thread { display: none; flex-direction: column; min-width: 0; min-height: 24rem; border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); background: var(--xw-surface); overflow: hidden; }
.xw-msg.has-selection .xw-msg-thread { display: flex; }
.xw-msg.has-selection .xw-msg-list { display: none; }
@container (min-width: 52rem) {
  .xw-msg-thread, .xw-msg.has-selection .xw-msg-thread, .xw-msg.has-selection .xw-msg-list { display: flex; height: 100%; }
  .xw-msg-back { display: none; }
}

.xw-msg-thread-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--xw-space-3); color: var(--xw-text-muted); text-align: center; padding: var(--xw-space-6); }
.xw-msg-thread-head { display: flex; align-items: center; gap: var(--xw-space-3); padding: var(--xw-space-3) var(--xw-space-4); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-msg-bubbles { flex: 1; list-style: none; margin: 0; padding: var(--xw-space-4); overflow-y: auto; display: flex; flex-direction: column; gap: var(--xw-space-2); }
.xw-bubble { max-width: 75%; padding: var(--xw-space-2) var(--xw-space-3); border-radius: var(--xw-radius-lg); }
.xw-bubble-text { display: block; overflow-wrap: anywhere; white-space: pre-wrap; font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-bubble-time { display: block; margin-top: 2px; font: var(--xw-text-xs)/1 var(--xw-font); opacity: 0.7; }
.xw-bubble.is-theirs { align-self: flex-start; background: var(--xw-surface-alt); color: var(--xw-text); border-bottom-left-radius: var(--xw-radius-xs, 4px); }
.xw-bubble.is-mine { align-self: flex-end; background: var(--xw-accent); color: var(--xw-on-accent); border-bottom-right-radius: var(--xw-radius-xs, 4px); }

.xw-msg-compose { display: flex; align-items: center; gap: var(--xw-space-2); padding: var(--xw-space-3) var(--xw-space-4); border-top: 1px solid var(--xw-border-subtle); }
.xw-msg-input { flex: 1; min-height: var(--xw-touch); box-sizing: border-box; padding: 0 var(--xw-space-3); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); background: var(--xw-background); color: var(--xw-text); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); }
.xw-msg-send { flex: none; color: var(--xw-accent); }
.xw-msg-send:disabled { opacity: 0.4; cursor: not-allowed; }
`.trim();
}
