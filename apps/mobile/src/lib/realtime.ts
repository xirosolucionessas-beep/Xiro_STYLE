/**
 * Variante nativa (Android/iOS): no hay `EventSource` sin agregar una dependencia nueva, y la Agenda nativa ya se
 * refresca sola al volver a la pantalla (`useFocusEffect` en AgendaPanel) — alcance de este stream: solo web (ver
 * realtime.web.ts). No-op silencioso a propósito, mismo patrón que lib/push.ts / push.web.ts.
 */
export function useRealtimeAppointments(_onChange: () => void): void {
  // Nada que hacer en nativo.
}

/** Pedidos: en nativo la pantalla se refresca al volver a ella y llega el aviso push (mismo criterio que la Agenda). */
export function useRealtimeOrders(_onChange: () => void): void {
  // Nada que hacer en nativo.
}
