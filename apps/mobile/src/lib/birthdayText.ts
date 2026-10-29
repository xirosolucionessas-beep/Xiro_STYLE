import { formatMoney, whatsappLink, type BirthdayRewardDto, type BirthdayStatusDto, type Currency } from '@xiro/shared';

/**
 * Textos del programa de cumpleaños compartidos por la app nativa y la web (sin React Native ni DOM, para poder probarlos).
 * Nunca usan la fecha de nacimiento: solo la recompensa y su vigencia.
 */
type T = (key: string, params?: Record<string, string | number>) => string;

/** AAAA-MM-DD (fecha del negocio) → "21/06/2027" (formato fijo, igual que los avisos). */
export const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** "20% de descuento en servicios (compra mínima $50.000)". */
export function describeReward(t: T, reward: Pick<BirthdayRewardDto, 'rewardKind' | 'rewardValue' | 'scope' | 'minTotal'>, currency: Currency): string {
  const base = reward.rewardKind === 'percent' ? t('birthday_reward_percent', { value: reward.rewardValue }) : t('birthday_reward_fixed', { value: formatMoney(reward.rewardValue, currency) });
  const scope = reward.scope === 'services' ? t('birthday_reward_scope_services') : reward.scope === 'products' ? t('birthday_reward_scope_products') : '';
  const min = reward.minTotal > 0 ? t('birthday_reward_min', { amount: formatMoney(reward.minTotal, currency) }) : '';
  return `${base}${scope}${min}`;
}

/** Texto del estado de cumpleaños de un cliente para el negocio (ficha del cliente). */
export function birthdayStatusText(t: T, status: BirthdayStatusDto, currency: Currency): string {
  if (!status.programEnabled) return t('birthday_status_off');
  if (!status.hasBirthDate) return t('birthday_status_no_date');
  const reward = status.reward;
  if (!reward) return t('birthday_status_none');
  if (reward.state === 'available') return t('birthday_state_available', { reward: describeReward(t, reward, currency), date: formatDay(reward.endsOn) });
  if (reward.state === 'expired') return t('birthday_state_expired', { date: formatDay(reward.endsOn) });
  return t(reward.state === 'claimed' ? 'birthday_state_claimed' : 'birthday_state_redeemed');
}

/**
 * Enlace de WhatsApp con la felicitación LISTA PARA REVISAR: abre WhatsApp y la persona del negocio decide si la envía.
 * No hay envío automático ni proveedor. Solo nombre, negocio, recompensa y vigencia (nunca la fecha de nacimiento).
 */
export function birthdayWhatsappUrl(t: T, input: { phone: string; clientName: string; businessName: string; reward: BirthdayRewardDto; message: string; currency: Currency }): string {
  const text = t('birthday_whatsapp_text', {
    name: input.clientName.split(' ')[0] ?? input.clientName,
    business: input.businessName,
    reward: describeReward(t, input.reward, input.currency),
    date: formatDay(input.reward.endsOn),
    message: input.message,
  }).trim();
  return whatsappLink(input.phone, text);
}
