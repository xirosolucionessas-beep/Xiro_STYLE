import { font } from './tokens';

/** CSS de la pantalla de Perfil (Web): datos de cuenta y el cambio de celular con verificación por código. Se añade a buildCss(). */
export function buildProfileCss(): string {
  return `
/* Ancho responsivo: alberga la cuadrícula de dos tarjetas (Perfil y negocio / Seguridad) de ~480px cada una
   cuando el ancho real alcanza; si no, .xw-profile-grid las apila (ver abajo). */
.xw-profile-content { display: flex; flex-direction: column; width: 100%; max-width: 62.5rem; margin: 0 auto; box-sizing: border-box; }
/* auto-fit: dos columnas de ~480px cuando el ancho REAL disponible alcanza (igual que .xw-kpis/.xw-cards); si no
   alcanza (tablet angosta, móvil), cada tarjeta pasa sola a su propia fila, sin depender de data-mode. */
.xw-profile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); align-items: stretch; gap: var(--xw-space-4); }
.xw-profile-panel { display: flex; flex-direction: column; height: 100%; }
.xw-profile-avatar-row { display: flex; align-items: center; gap: var(--xw-space-4); margin-bottom: var(--xw-space-6); }
.xw-avatar-edit { position: relative; flex: none; }
.xw-avatar--xl { width: 84px; height: 84px; font-size: var(--xw-text-xl); }
.xw-profile-field { margin: 0 0 var(--xw-space-6); }
.xw-profile-view { margin: 0 0 var(--xw-space-6); padding-top: var(--xw-space-4); border-top: 1px solid var(--xw-border-subtle); }
.xw-profile-value { margin: var(--xw-space-1) 0 0; color: var(--xw-text); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); overflow-wrap: anywhere; }
.xw-profile-phone-row { display: flex; align-items: center; justify-content: space-between; gap: var(--xw-space-3); }
.xw-profile-phone-panel { box-sizing: border-box; margin-top: var(--xw-space-3); padding: var(--xw-space-4); background: var(--xw-surface-tint); border: 1px solid var(--xw-border-subtle); border-radius: var(--xw-radius-lg);
  display: flex; flex-direction: column; gap: var(--xw-space-3); }
.xw-profile-panel-title { margin: 0; color: var(--xw-text); font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-profile-phone-actions { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); }
/* Pie de cada tarjeta (botón Guardar / Actualizar contraseña): empujado al final, fuera del flujo de campos. */
.xw-profile-panel-foot { margin-top: auto; padding-top: var(--xw-space-4); }

/* "Opciones avanzadas del negocio": cerrado por defecto y a todo lo ancho, después de las dos tarjetas. */
.xw-profile-advanced-wrap { margin-top: var(--xw-space-2); }
.xw-profile-divider { border: 0; border-top: 1px solid var(--xw-border-subtle); margin: 0 0 var(--xw-space-5); }
.xw-profile-advanced-toggle { display: flex; align-items: center; gap: var(--xw-space-2); box-sizing: border-box; width: 100%; min-height: var(--xw-touch);
  padding: var(--xw-space-2) 0; background: none; border: 0; color: var(--xw-text); cursor: pointer; text-align: left;
  font: ${font.weight.extrabold} var(--xw-text-md)/${font.lineHeight.tight} var(--xw-font); }
.xw-profile-advanced-toggle:hover { color: var(--xw-accent); }
.xw-profile-advanced-body { margin-top: var(--xw-space-3); }
`.trim();
}
