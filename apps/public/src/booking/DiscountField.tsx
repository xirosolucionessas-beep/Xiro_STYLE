import { computeDiscount, discountCodeSchema, type Currency, type PublicDiscountDto } from '@xiro/shared';
import { useState } from 'react';
import { ApiError, publicApi } from '../api';
import { money } from '../lib/format';
import { errorKey } from '../lib/useAsync';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

type T = (key: string, params?: Record<string, string | number>) => string;

/** Mensaje de un código rechazado (el mínimo de compra se dice con su monto). */
export function discountErrorText(error: unknown, t: T, currency: Currency | string): string {
  if (error instanceof ApiError && error.code === 'discount_min_total') return t('discount_min_total', { amount: money(Number(error.extra.minTotal ?? 0), currency) });
  return t(errorKey(error));
}

/**
 * "¿Tienes un código?" en el resumen (Fase 4, si el negocio usa códigos). Se valida en el servidor solo para mostrar el ahorro;
 * el descuento real lo decide y lo cuenta el servidor al confirmar (un código agotado entre tanto se rechaza allí).
 */
export function DiscountField({
  slug,
  subtotal,
  currency,
  applied,
  onApplied,
  t,
}: {
  slug: string;
  subtotal: number;
  currency: Currency | string;
  applied: PublicDiscountDto | null;
  onApplied: (discount: PublicDiscountDto | null) => void;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);

  async function apply() {
    setError(undefined);
    const parsed = discountCodeSchema.safeParse(value);
    if (!parsed.success) return setError(t('discount_code_format'));
    setChecking(true);
    try {
      const discount = await publicApi.discount(slug, parsed.data);
      if (subtotal < discount.minTotal) return setError(t('discount_min_total', { amount: money(discount.minTotal, currency) }));
      onApplied(discount);
      setValue('');
      setOpen(false);
    } catch (e) {
      setError(discountErrorText(e, t, currency));
    } finally {
      setChecking(false);
    }
  }

  if (applied) {
    const amount = computeDiscount(subtotal, applied);
    return (
      <div className="xp-discount is-applied" role="status">
        <Icon name="check" size={16} />
        <span className="xp-discount-text">
          <strong>{applied.code}</strong>
          {applied.description ? <span className="xp-muted"> · {applied.description}</span> : null}
          <span className="xp-discount-save"> {t('pub_discount_saving', { amount: money(amount, currency) })}</span>
        </span>
        <button type="button" className="xp-link-btn" onClick={() => onApplied(null)}>
          {t('pub_discount_remove')}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="xp-link-btn xp-discount-open" onClick={() => setOpen(true)}>
        <Icon name="tag" size={16} /> {t('pub_discount_have_code')}
      </button>
    );
  }

  return (
    <div className="xp-discount">
      <label className="xp-field" htmlFor="xp-discount-code">
        <span className="xp-label">{t('pub_discount_label')}</span>
        <span className="xp-discount-row">
          <input
            id="xp-discount-code"
            className={`xp-input${error ? ' has-error' : ''}`}
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void apply();
              }
            }}
            maxLength={30}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={Boolean(error)}
          />
          <Button variant="secondary" full={false} loading={checking} onClick={() => void apply()}>
            {t('pub_discount_apply')}
          </Button>
        </span>
        {error ? (
          <span className="xp-error" role="alert">
            {error}
          </span>
        ) : null}
      </label>
    </div>
  );
}
