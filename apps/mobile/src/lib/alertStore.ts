import { useEffect, useSyncExternalStore } from 'react';
import { emptyAlertState, parseAlertState, serializeAlertState, type AlertState } from './alerts';
import { prefsStorage } from './storage';

/**
 * Estado local de lectura de alertas (leídas / descartadas / desde cuándo se ven), compartido entre el Inicio, la campana,
 * el menú lateral y la pantalla de Notificaciones. No existe historial de notificaciones en el backend, así que vive en el
 * dispositivo, separado por negocio. Si algún día el backend lo guarda, este es el único punto que habría que cambiar.
 */
let businessId: string | null = null;
let state: AlertState = emptyAlertState();
let loaded = false;
const listeners = new Set<() => void>();

const keyFor = (id: string) => `xiro.alerts.${id}`;
const emit = () => listeners.forEach((listener) => listener());

async function load(id: string): Promise<void> {
  if (businessId === id) return;
  businessId = id;
  loaded = false;
  state = emptyAlertState();
  emit();
  const stored = parseAlertState(await prefsStorage.get(keyFor(id)));
  if (businessId !== id) return; // cambió de negocio (cierre de sesión) mientras cargaba
  // Lo marcado mientras cargaba (p. ej. "visto") se conserva encima de lo guardado.
  state = { read: [...new Set([...stored.read, ...state.read])], dismissed: [...new Set([...stored.dismissed, ...state.dismissed])], seen: { ...stored.seen, ...state.seen } };
  loaded = true;
  emit();
}

export function updateAlertState(change: (current: AlertState) => AlertState): void {
  const next = change(state);
  if (next === state) return;
  state = next;
  emit();
  if (businessId) void prefsStorage.set(keyFor(businessId), serializeAlertState(state));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Estado de alertas del negocio actual; carga lo guardado al montarse. */
export function useAlertState(id: string | undefined): { state: AlertState; loaded: boolean } {
  const current = useSyncExternalStore(subscribe, () => state);
  const isLoaded = useSyncExternalStore(subscribe, () => loaded);
  useEffect(() => {
    if (id) void load(id);
  }, [id]);
  return { state: current, loaded: isLoaded };
}
