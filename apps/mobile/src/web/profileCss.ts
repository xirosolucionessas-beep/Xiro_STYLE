import { font } from './tokens';

/** CSS de la pantalla de Perfil (Web): datos de cuenta y el cambio de celular con verificación por código. Se añade a buildCss(). */
export function buildProfileCss(): string {
  return `
.xw-profile-content { display: flex; flex-direction: column; }
.xw-profile-field { margin: var(--xw-space-6) 0; }
.xw-profile-field .xw-btn { margin-top: var(--xw-space-2); }
.xw-profile-view { margin: 0 0 var(--xw-space-6); padding-top: var(--xw-space-4); border-top: 1px solid var(--xw-border-subtle); }
.xw-profile-value { margin: var(--xw-space-1) 0 0; color: var(--xw-text); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-profile-phone-row { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); }
.xw-profile-phone-panel { box-sizing: border-box; margin-top: var(--xw-space-3); padding: var(--xw-space-4); background: var(--xw-surface-tint); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg);
  display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-profile-panel-title { margin: 0; color: var(--xw-text); font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-profile-phone-actions { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); }
`.trim();
}
