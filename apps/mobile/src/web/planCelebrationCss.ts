import { font } from './tokens';

/** CSS de la animación "¡Bienvenido a Xiro Premium!" (Tarea 9): corona dorada + confeti sutil. Se añade a buildCss(). */
export function buildPlanCelebrationCss(): string {
  return `
.xw-celebrate-backdrop { position: fixed; inset: 0; z-index: 10300; display: flex; align-items: center; justify-content: center; padding: var(--xw-space-4);
  background: var(--xw-overlay); animation: xw-celebrate-fade .3s ease-out both; }
@keyframes xw-celebrate-fade { from { opacity: 0; } to { opacity: 1; } }

.xw-celebrate-card { position: relative; z-index: 1; box-sizing: border-box; width: 100%; max-width: 26rem; padding: var(--xw-space-8) var(--xw-space-6) var(--xw-space-6);
  text-align: center; background: var(--xw-surface); border: 1px solid rgba(217, 182, 54, .5); border-radius: var(--xw-radius-xl); overflow: hidden;
  box-shadow: 0 0 0 1px rgba(217, 182, 54, .12), 0 30px 70px -24px rgba(0, 0, 0, .85), 0 0 60px -16px rgba(217, 182, 54, .5);
  animation: xw-celebrate-in .45s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes xw-celebrate-in { from { opacity: 0; transform: scale(.85) translateY(12px); } to { opacity: 1; transform: none; } }

.xw-celebrate-crown { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 76px; height: 76px; margin-bottom: var(--xw-space-4);
  color: var(--xw-accent); }
.xw-celebrate-crown::before { content: ''; position: absolute; inset: -14px; border-radius: 50%;
  background: radial-gradient(circle, rgba(217, 182, 54, .55) 0%, rgba(217, 182, 54, 0) 70%); animation: xw-celebrate-shine 1.8s ease-in-out .2s infinite; }
@keyframes xw-celebrate-shine { 0%, 100% { opacity: .5; transform: scale(.92); } 50% { opacity: 1; transform: scale(1.08); } }

.xw-celebrate-title { margin: 0 0 var(--xw-space-2); font: ${font.weight.extrabold} var(--xw-text-xl)/${font.lineHeight.tight} var(--xw-font); background: linear-gradient(135deg, #f1d98a, #d9b636 55%, #b9932a);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.xw-celebrate-body { margin: 0 0 var(--xw-space-6); color: var(--xw-text-muted); font: var(--xw-text-md)/${font.lineHeight.normal} var(--xw-font); }
.xw-celebrate-body strong { color: var(--xw-text); }

.xw-celebrate-receipts { display: flex; flex-wrap: wrap; gap: var(--xw-space-2); justify-content: center; margin-bottom: var(--xw-space-2); }
.xw-celebrate-receipts > * { flex: 1 1 auto; }

/* Confeti dorado sutil: unos pocos puntos que caen desde arriba de la tarjeta y se desvanecen. Nunca bloquea los clics. */
.xw-celebrate-confetti { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.xw-celebrate-dot { position: absolute; top: -10%; width: 6px; height: 6px; border-radius: 1px; background: var(--xw-accent); opacity: 0;
  animation: xw-celebrate-fall 1.6s ease-in both; }
@keyframes xw-celebrate-fall { 0% { opacity: 0; transform: translateY(0) translateX(0) rotate(0deg); } 15% { opacity: .9; } 100% { opacity: 0; transform: translateY(220px) translateX(var(--xw-drift, 0px)) rotate(200deg); } }

@media (prefers-reduced-motion: reduce) { .xw-celebrate-crown::before { animation: none; opacity: .8; } }
`;
}
