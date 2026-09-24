import { Ico } from '../icons';
import { useWebStyles } from './shared';

/**
 * Botón flotante del asistente (sección 4B): círculo dorado justo encima del de WhatsApp (mismo hueco de 12px,
 * ver `.xw-fab-stack`), icono Sparkles. Nunca se superponen: viven en la misma pila, uno arriba del otro.
 */
export function FloatingAssistant({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  useWebStyles();
  return (
    <button type="button" className="xw-fab xw-fab--assistant" aria-label={label} aria-haspopup="dialog" aria-expanded={open} title={label} onClick={onPress}>
      <Ico name="sparkles" size={24} />
    </button>
  );
}
