import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { CASH_LIVE_INTERVAL_MS } from './cashBreakdown';

/**
 * Android/iOS: intervalo de React Query para una pantalla que se actualiza sola (`false` = no pedir). Solo cuenta mientras
 * `enabled` (p. ej. el día de hoy), la pantalla está enfocada y la app en primer plano: en segundo plano o en otra pantalla
 * no se hace ninguna petición. Al volver (app activa o pantalla enfocada otra vez) llama `onResume` una vez, para no
 * esperar al siguiente intervalo. React Query ya evita peticiones duplicadas de la misma consulta.
 */
export function useLiveRefresh(enabled: boolean, onResume: () => void, intervalMs = CASH_LIVE_INTERVAL_MS): { interval: number | false; active: boolean; now: number } {
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const active = enabled && focused && appActive;
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
