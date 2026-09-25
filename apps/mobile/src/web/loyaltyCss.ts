import { font } from './tokens';

/** CSS de la pantalla de Fidelización (Web): pestañas, tarjetas de progreso por cliente e historial. Se añade a buildCss(). */
export function buildLoyaltyCss(): string {
  return `
.xw-loy-config { max-width: 42rem; }

.xw-loy-tabs { display: flex; gap: var(--xw-space-2); margin-bottom: var(--xw-space-6); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-loy-tab { box-sizing: border-box; min-height: var(--xw-touch); padding: 0 var(--xw-space-3); background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px;
  color: var(--xw-text-muted); cursor: pointer; font: ${font.weight.bold} var(--xw-text-md)/1 var(--xw-font); }
.xw-loy-tab:hover { color: var(--xw-text); }
.xw-loy-tab.is-active { color: var(--xw-accent); border-color: var(--xw-accent); }

.xw-loy-config { display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-loy-items { display: flex; flex-direction: column; gap: var(--xw-space-1); max-height: 16rem; overflow-y: auto; padding: var(--xw-space-2); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-md); }

.xw-loy-clients { display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-loy-client-card { box-sizing: border-box; padding: var(--xw-space-4); background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); }
.xw-loy-client-top { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-2); margin-bottom: var(--xw-space-2); }
.xw-loy-client-name { color: var(--xw-text); font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-loy-client-count { flex: none; color: var(--xw-text-muted); font: ${font.weight.bold} var(--xw-text-sm)/1 var(--xw-font); font-variant-numeric: tabular-nums; }
.xw-loy-bar { width: 100%; height: 10px; border-radius: var(--xw-radius-pill); background: var(--xw-surface-alt); overflow: hidden; }
.xw-loy-bar-fill { height: 100%; border-radius: var(--xw-radius-pill); background: var(--xw-accent); transition: width var(--xw-base) ease; }
.xw-loy-client-actions { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); margin-top: var(--xw-space-3); }

.xw-loy-history { display: flex; flex-direction: column; gap: var(--xw-space-2); margin: 0; padding: 0; list-style: none; }
.xw-loy-history-row { display: flex; align-items: center; gap: var(--xw-space-3); box-sizing: border-box; padding: var(--xw-space-3); background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-md); color: var(--xw-accent); }
.xw-loy-history-text { flex: 1; min-width: 0; color: var(--xw-text); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-loy-history-date { flex: none; color: var(--xw-text-muted); font: var(--xw-text-xs)/1 var(--xw-font); }
`.trim();
}
