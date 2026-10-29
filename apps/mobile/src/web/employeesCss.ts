import { font } from './tokens';

/** CSS de la pantalla de Empleados (Web): pestañas, tarjetas del equipo, permisos y bitácora. Se añade a buildCss(). */
export function buildEmployeesCss(): string {
  return `

.xw-emp-tabs { display: flex; gap: var(--xw-space-2); margin-bottom: var(--xw-space-6); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-emp-tab { box-sizing: border-box; min-height: var(--xw-touch); padding: 0 var(--xw-space-3); background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px;
  color: var(--xw-text-muted); cursor: pointer; font: ${font.weight.bold} var(--xw-text-md)/1 var(--xw-font); }
.xw-emp-tab:hover { color: var(--xw-text); }
.xw-emp-tab.is-active { color: var(--xw-accent); border-color: var(--xw-accent); }

.xw-emp-team { display: flex; flex-direction: column; gap: var(--xw-space-4); align-items: flex-start; }
/* Cupos de empleados activos ("3 de 5"). */
.xw-emp-quota { width: 100%; padding: var(--xw-space-3); border: 1px solid var(--xw-border); border-radius: var(--xw-radius-md); }
.xw-emp-quota p { margin: var(--xw-space-1) 0 0; }
.xw-emp-quota .is-danger { color: var(--xw-danger); }
.xw-emp-list { display: flex; flex-direction: column; gap: var(--xw-space-3); width: 100%; margin: 0; padding: 0; list-style: none; }
.xw-emp-card { box-sizing: border-box; padding: var(--xw-space-4); background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg); }
.xw-emp-card.is-inactive { opacity: 0.7; }
.xw-emp-top { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-2); }
.xw-emp-name { color: var(--xw-text); font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); overflow-wrap: anywhere; }
.xw-emp-status { flex: none; padding: 2px var(--xw-space-2); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-pill); color: var(--xw-text-muted); font: ${font.weight.bold} var(--xw-text-xs)/1.4 var(--xw-font); }
.xw-emp-status.is-on { color: var(--xw-accent); border-color: var(--xw-accent); }
.xw-emp-contact { margin: var(--xw-space-1) 0 var(--xw-space-3); color: var(--xw-text-muted); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-emp-chips { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); margin: 0; padding: 0; list-style: none; }
.xw-emp-chip { padding: 2px var(--xw-space-2); background: var(--xw-surface-alt); border-radius: var(--xw-radius-pill); color: var(--xw-text); font: var(--xw-text-xs)/1.5 var(--xw-font); }
.xw-emp-chip.is-empty { color: var(--xw-text-muted); }
.xw-emp-actions { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); margin-top: var(--xw-space-3); }

.xw-emp-perms { display: flex; flex-direction: column; gap: var(--xw-space-2); margin: 0; padding: 0; border: 0; min-width: 0; }
.xw-emp-perms legend { padding: 0; }
.xw-emp-perm { display: flex; flex-direction: column; gap: 2px; padding-bottom: var(--xw-space-2); border-bottom: 1px solid var(--xw-border-subtle); }
.xw-emp-perm .xw-hint { margin: 0 0 0 var(--xw-space-8); }

.xw-emp-log { display: flex; flex-direction: column; gap: var(--xw-space-2); margin: 0; padding: 0; list-style: none; }
.xw-emp-log-row { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); box-sizing: border-box; padding: var(--xw-space-3); background: var(--xw-surface); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-md); }
.xw-emp-log-text { flex: 1; min-width: 0; color: var(--xw-text); font: var(--xw-text-sm)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-emp-denied { color: var(--xw-text-muted); font-style: italic; }
.xw-emp-log-date { flex: none; color: var(--xw-text-muted); font: var(--xw-text-xs)/1 var(--xw-font); }
`.trim();
}
