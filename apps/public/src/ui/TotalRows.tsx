import { appliedDiscountLabel, type AppliedDiscountDto, type Currency } from '@xiro/shared';
import { money } from '../lib/format';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * El total de una cita o pedido. Con un código de descuento (Fase 4) muestra el subtotal, la línea del descuento y el total a
 * pagar; sin él, exactamente la misma fila de total de siempre.
 */
export function TotalRows({
  total,
  discount,
  currency,
  t,
  rowClass = 'xp-summary-total',
  priceClass = 'xp-price xp-price--lg',
}: {
  total: number;
  discount: AppliedDiscountDto | null | undefined;
  currency: Currency | string;
  t: T;
  rowClass?: string;
  priceClass?: string;
}) {
  const amount = discount ? Math.min(discount.amount, total) : 0;
  return (
    <>
      {discount && amount > 0 ? (
        <>
          <div className={`${rowClass} xp-summary-sub`}>
            <span>{t('pub_summary_subtotal')}</span>
            <span>{money(total, currency)}</span>
          </div>
          <div className={`${rowClass} xp-summary-sub xp-summary-discount`}>
            <span>{appliedDiscountLabel(t, discount, 'pub_birthday_discount')}</span>
            <span>−{money(amount, currency)}</span>
          </div>
        </>
      ) : null}
      <div className={rowClass}>
        <span>{t('pub_summary_total')}</span>
        <span className={priceClass}>{money(total - amount, currency)}</span>
      </div>
    </>
  );
}
