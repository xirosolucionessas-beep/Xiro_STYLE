import { type BirthdayRewardDto, type ClientBirthdayDto, type Currency } from '@xiro/shared';
import { money } from './format';

type T = (key: string, params?: Record<string, string | number>) => string;

/** AAAA-MM-DD (fecha del negocio) → "21/06/2027". */
export const formatRewardDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** "20% de descuento en servicios (compra mínima $50.000)" — mismos textos que la app del negocio. */
export function describeBirthdayReward(t: T, reward: Pick<BirthdayRewardDto, 'rewardKind' | 'rewardValue' | 'scope' | 'minTotal'>, currency: Currency | string): string {
  const base = reward.rewardKind === 'percent' ? t('birthday_reward_percent', { value: reward.rewardValue }) : t('birthday_reward_fixed', { value: money(reward.rewardValue, currency) });
  const scope = reward.scope === 'services' ? t('birthday_reward_scope_services') : reward.scope === 'products' ? t('birthday_reward_scope_products') : '';
  const min = reward.minTotal > 0 ? t('birthday_reward_min', { amount: money(reward.minTotal, currency) }) : '';
  return `${base}${scope}${min}`;
}

/** Estado del regalo de cumpleaños para la propia persona (su cuenta). null = el negocio no tiene el programa activo. */
export function birthdayAccountText(t: T, info: ClientBirthdayDto, currency: Currency | string): string | null {
  if (!info.active) return null;
  if (!info.hasBirthDate) return t('pub_birthday_no_date');
  const reward = info.reward;
  if (!reward) return t('pub_birthday_none');
  if (reward.state === 'available') return t('pub_birthday_available', { reward: describeBirthdayReward(t, reward, currency), date: formatRewardDay(reward.endsOn) });
  if (reward.state === 'expired') return t('pub_birthday_expired', { date: formatRewardDay(reward.endsOn) });
  return t(reward.state === 'claimed' ? 'pub_birthday_claimed' : 'pub_birthday_redeemed');
}
