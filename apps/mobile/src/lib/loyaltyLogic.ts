/** Porcentaje de la barra de progreso (0–100): nunca pasa de 100 aunque el cliente lleve más sellos que la meta. */
export const progressPercent = (count: number, goal: number): number => (goal <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((count / goal) * 100))));
