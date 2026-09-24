import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, useWebStyles } from './shared';

export type ToastTone = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  /** ms; 0 = permanece hasta que la persona lo cierre (por defecto en errores, WCAG 2.2.1). */
  duration: number;
}

export interface ToastApi {
  show: (message: string, options?: { tone?: ToastTone; duration?: number }) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION: Record<ToastTone, number> = { info: 6000, success: 6000, error: 0 };

function ToastCard({ toast, dismissLabel, onDismiss }: { toast: ToastItem; dismissLabel: string; onDismiss: (id: number) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const card = useRef<HTMLDivElement>(null);

  // Pausa el cierre automático mientras se apunta o se enfoca el aviso (WCAG 2.2.1).
  // Listeners nativos: el contenedor del aviso no es un elemento interactivo.
  useEffect(() => {
    const element = card.current;
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const start = () => {
      clear();
      if (toast.duration > 0) timer.current = setTimeout(() => onDismiss(toast.id), toast.duration);
    };
    start();
    element?.addEventListener('mouseover', clear);
    element?.addEventListener('mouseout', start);
    element?.addEventListener('focusin', clear);
    element?.addEventListener('focusout', start);
    return () => {
      clear();
      element?.removeEventListener('mouseover', clear);
      element?.removeEventListener('mouseout', start);
      element?.removeEventListener('focusin', clear);
      element?.removeEventListener('focusout', start);
    };
  }, [toast.duration, toast.id, onDismiss]);

  return (
    <div ref={card} className={`xw-toast xw-toast--${toast.tone}`}>
      <span className="xw-toast-ic">
        <Icon name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'info'} />
      </span>
      <span className="xw-toast-msg">{toast.message}</span>
      <button type="button" className="xw-icon-btn" style={{ marginRight: 0 }} aria-label={dismissLabel} onClick={() => onDismiss(toast.id)}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

/**
 * Avisos accesibles: los informativos/éxito van en una región role="status" (educada) y los errores en role="alert".
 * Ambas regiones existen siempre en el DOM para que los lectores de pantalla anuncien los mensajes nuevos.
 */
export function ToastProvider({ children, dismissLabel = 'Cerrar aviso' }: { children: ReactNode; dismissLabel?: string }) {
  useWebStyles();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastApi['show']>((message, options) => {
    const tone = options?.tone ?? 'info';
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, tone, duration: options?.duration ?? DEFAULT_DURATION[tone] }]);
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="xw-toasts">
        <div role="status" aria-live="polite">
          {toasts.filter((t) => t.tone !== 'error').map((t) => (
            <ToastCard key={t.id} toast={t} dismissLabel={dismissLabel} onDismiss={dismiss} />
          ))}
        </div>
        <div role="alert">
          {toasts.filter((t) => t.tone === 'error').map((t) => (
            <ToastCard key={t.id} toast={t} dismissLabel={dismissLabel} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast debe usarse dentro de ToastProvider');
  return api;
}
