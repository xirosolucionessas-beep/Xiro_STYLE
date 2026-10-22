import { birthdayDiscount, eligibleSubtotal, type BirthdayRewardDto, type BirthdayStatusDto } from '@xiro/shared';

/**
 * Recompensa de cumpleaños en la caja: lo que se le muestra al cajero ANTES de cobrar. Usa las mismas funciones que el
 * servidor (que vuelve a validar y calcular todo): si algo no cuadra, la venta se rechaza, nunca se cobra de más o de menos.
 */
export type BirthdaySalePreview =
  | { kind: 'none' }
  | { kind: 'ready'; reward: BirthdayRewardDto; amount: number }
  | { kind: 'blocked'; reward: BirthdayRewardDto; reason: 'birthday_not_combinable' | 'birthday_min_total' | 'birthday_nothing_left' };

export function birthdaySalePreview(status: BirthdayStatusDto | undefined, lines: Array<{ kind: 'service' | 'product'; unitPrice: number; quantity: number }>, manualDiscount: number): BirthdaySalePreview {
  const reward = status?.programEnabled ? status.reward : null;
  if (!reward || reward.state !== 'available') return { kind: 'none' };
  if (!reward.combinable && manualDiscount > 0) return { kind: 'blocked', reward, reason: 'birthday_not_combinable' };
  const totals = lines.map((l) => ({ kind: l.kind, total: l.unitPrice * l.quantity }));
  const amount = birthdayDiscount(eligibleSubtotal(totals, reward.scope), reward);
  if (amount === 0) return { kind: 'blocked', reward, reason: 'birthday_min_total' };
  // Igual que el servidor: junto al descuento manual nunca deja el total por debajo de 0.
  const left = Math.max(0, totals.reduce((sum, l) => sum + l.total, 0) - manualDiscount);
  return left > 0 ? { kind: 'ready', reward, amount: Math.min(amount, left) } : { kind: 'blocked', reward, reason: 'birthday_nothing_left' };
}
