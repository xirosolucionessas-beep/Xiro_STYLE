import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { CASH_LIVE_INTERVAL_MS } from './cashBreakdown';

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * Web: igual que la versión nativa, pero "activa" = ruta enfocada, pestaña visible y con conexión. Con la pestaña oculta o sin red no se pide nada; al volver se pide una vez y se retoma el intervalo.
 */
export function useLiveRefresh(enabled: boolean, onResume: () => void, intervalMs = CASH_LIVE_INTERVAL_MS): { interval: number | false; active: boolean; now: number } {
  const [pageActive, setPageActive] = useState(() => visible() && online());
  useEffect(() => {
    const update = () => setPageActive(visible() && online());
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const focused = useIsFocused();
  const active = enabled && focused && pageActive;
  const resumeRef = useRef(onResume);
  useEffect(() => {
    resumeRef.current = onResume;
  }, [onResume]);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) resumeRef.current();
    wasActive.current = active;
  }, [active]);

  // Reloj para saber si los datos quedaron viejos (sin llamar Date.now() durante el render); solo corre mientras está activa.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [active]);

  return { interval: active ? intervalMs : false, active, now };
}
