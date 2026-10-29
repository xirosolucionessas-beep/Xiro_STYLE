import { formatClock, formatDay, localDate, localTime, upperFirst, type AppliedDiscountDto, type Language, type PublicBookingCatalog, type PublicBookingProfile, type PublicTeamMemberDto } from '@xiro/shared';
import type { ReactNode } from 'react';
import { initials, money } from '../lib/format';
import { Alert } from '../ui/Alert';
import { Icon } from '../ui/Icon';
import { MemberMeta } from '../ui/MemberMeta';
import { ListSkeleton } from '../ui/Skeleton';
import { TotalRows } from '../ui/TotalRows';
import { Turnstile } from '../ui/Turnstile';
import type { DetailItem } from '../profile/ItemDetailModal';
import type { Chosen } from './BookingFlow';

/** Lo que el flujo necesita para abrir el detalle (fotos e información completa) de un servicio o producto. */
export type OpenDetail = (item: DetailItem, kind: 'service' | 'product') => void;

const usefulDescription = (description: string, name: string) => (description && description !== name && !/^[\d\s.,-]+$/.test(description) ? description : '');

type T = (key: string, params?: Record<string, string | number>) => string;

/* ---------- 1. Servicio ---------- */

export function ServicesStep({
  catalog,
  loading,
  chosen,
  currency,
  t,
  acceptsProductOrders = false,
  orderMode = false,
  onToggleService,
  onSetVariant,
  onTogglePackage,
  onSetProductQty,
  onOpenDetail,
}: {
  catalog: PublicBookingCatalog;
  loading: boolean;
  chosen: Chosen;
  currency: string;
  t: T;
  /** El negocio acepta pedidos de solo productos (sin cita). */
  acceptsProductOrders?: boolean;
  /** Lo elegido es solo productos: se pedirá sin profesional ni horario. */
  orderMode?: boolean;
  onToggleService: (id: string, on: boolean) => void;
  onSetVariant: (id: string, variantId: string | null) => void;
  onTogglePackage: (id: string, on: boolean) => void;
  onSetProductQty: (id: string, quantity: number) => void;
  /** Abre el detalle de un artículo (fotos e información completa) sin salir del flujo. */
  onOpenDetail?: OpenDetail;
}) {
  if (loading) return <ListSkeleton rows={4} />;
  const products = catalog.products.filter((p) => p.inStock);
  return (
    <div className="xp-stack">
      {/* Un negocio que solo vende productos no tiene servicios que sumar: la pista habla de productos. */}
      <p className="xp-hint">{t(acceptsProductOrders && catalog.services.length + catalog.packages.length === 0 ? 'pub_order_pick_hint' : 'pub_services_pick_hint')}</p>
      {orderMode ? (
        <p className="xp-hint" role="status">
          <Icon name="bag" size={14} /> {t('pub_order_mode_note')}
        </p>
      ) : null}
      {/* Servicios y "Para llevar" bien separados cuando el negocio ofrece ambos. */}
      {products.length > 0 && catalog.services.length + catalog.packages.length > 0 ? <h3 className="xp-subtitle xp-flow-subtitle">{t('pub_services_heading')}</h3> : null}
      {catalog.services.map((service) => {
        const picked = chosen.services.find((s) => s.itemId === service.id);
        const description = service.description && service.description !== service.name ? service.description : '';
        return (
          <div key={service.id} className={`xp-choice${picked ? ' is-picked' : ''}`}>
            <label className="xp-choice-main">
              <input className="xp-choice-input" type="checkbox" checked={Boolean(picked)} onChange={(e) => onToggleService(service.id, e.target.checked)} />
              <span className="xp-choice-check" aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
              <span className="xp-choice-text">
                <span className="xp-choice-name">{service.name}</span>
                {description ? <span className="xp-choice-desc">{description}</span> : null}
                <span className="xp-meta">
                  <Icon name="clock" size={14} /> {t('pub_minutes', { minutes: service.durationMinutes })}
                </span>
              </span>
              <span className="xp-price">{money(service.price, currency)}</span>
            </label>
            {onOpenDetail ? (
              <button
                type="button"
                className="xp-link-btn xp-choice-detail"
                aria-label={t('pub_detail_open', { name: service.name })}
                onClick={() => onOpenDetail({ id: service.id, name: service.name, category: service.category, description: usefulDescription(service.fullDescription || description, service.name), detail: service.detail ?? '', images: service.images, durationMinutes: service.durationMinutes, price: service.price, fromPrice: service.variants.some((v) => v.price !== service.price) }, 'service')}>
                <Icon name="image" size={16} /> {t('pub_detail_short')}
              </button>
            ) : null}
            {picked && service.variants.length > 0 ? (
              <div className="xp-chips xp-choice-variants" role="radiogroup" aria-label={t('pub_style_label')}>
                <button type="button" role="radio" className="xp-chip" aria-checked={!picked.variantId} onClick={() => onSetVariant(service.id, null)}>
                  {t('pub_style_base')}
                </button>
                {service.variants.map((v) => (
                  <button key={v.id} type="button" role="radio" className="xp-chip" aria-checked={picked.variantId === v.id} onClick={() => onSetVariant(service.id, v.id)}>
                    {v.name} · {money(v.price, currency)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {catalog.packages.map((pkg) => {
        const picked = chosen.packages.includes(pkg.id);
        return (
          <div key={pkg.id} className={`xp-choice${picked ? ' is-picked' : ''}`}>
            <label className="xp-choice-main">
              <input className="xp-choice-input" type="checkbox" checked={picked} onChange={(e) => onTogglePackage(pkg.id, e.target.checked)} />
              <span className="xp-choice-check" aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
              <span className="xp-choice-text">
                <span className="xp-choice-name">
                  {pkg.name} <span className="xp-tag">{t('pub_package_badge')}</span>
                </span>
                <span className="xp-choice-desc">{t('pub_package_includes', { services: pkg.services.join(' + ') })}</span>
                <span className="xp-meta">
                  <Icon name="clock" size={14} /> {t('pub_minutes', { minutes: pkg.durationMinutes })}
                </span>
              </span>
              <span className="xp-price">{money(pkg.price, currency)}</span>
            </label>
          </div>
        );
      })}
      {products.length > 0 ? (
        <>
          <h3 className="xp-subtitle xp-flow-subtitle">
            {t('pub_takeaway_heading')} <span className="xp-muted">· {t('pub_nav_products')}</span>
          </h3>
          {products.map((product) => {
            const qty = chosen.products.find((p) => p.itemId === product.id)?.quantity ?? 0;
            return (
              <div key={product.id} className="xp-choice xp-choice--row">
                <span className="xp-choice-text">
                  <span className="xp-choice-name">{product.name}</span>
                  <span className="xp-price">{money(product.price, currency)}</span>
                  {onOpenDetail ? (
                    <button
                      type="button"
                      className="xp-link-btn xp-choice-detail"
                      aria-label={t('pub_detail_open', { name: product.name })}
                      onClick={() => onOpenDetail({ id: product.id, name: product.name, description: usefulDescription(product.fullDescription || product.description, product.name), detail: product.detail ?? '', images: product.images, price: product.price }, 'product')}>
                      <Icon name="image" size={16} /> {t('pub_detail_short')}
                    </button>
                  ) : null}
                </span>
                <span className="xp-qty">
                  <button type="button" className="xp-qty-btn" aria-label={`− ${product.name}`} disabled={qty === 0} onClick={() => onSetProductQty(product.id, qty - 1)}>
                    −
                  </button>
                  <span aria-live="polite">{qty}</span>
                  <button type="button" className="xp-qty-btn" aria-label={`+ ${product.name}`} disabled={qty >= 20} onClick={() => onSetProductQty(product.id, qty + 1)}>
                    +
                  </button>
                </span>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

/* ---------- 2. Profesional ---------- */

export function ProfessionalStep({ team, value, t, language = 'es', onChange }: { team: PublicTeamMemberDto[]; value: string; t: T; language?: string; onChange: (id: string) => void }) {
  return (
    <div className="xp-stack" role="radiogroup" aria-label={t('pub_professional_step_title')}>
      <button type="button" role="radio" aria-checked={value === 'any'} className={`xp-pro${value === 'any' ? ' is-picked' : ''}`} onClick={() => onChange('any')}>
        <span className="xp-pro-photo xp-pro-photo--any" aria-hidden="true">
          <Icon name="sparkle" size={26} />
        </span>
        <span className="xp-pro-text">
          <span className="xp-choice-name">{t('pub_any_professional')}</span>
          <span className="xp-choice-desc">{t('pub_any_professional_hint')}</span>
        </span>
        <span className="xp-choice-check" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
      </button>
      {team.map((member) => (
        <button key={member.id} type="button" role="radio" aria-checked={value === member.id} className={`xp-pro${value === member.id ? ' is-picked' : ''}`} onClick={() => onChange(member.id)}>
          {member.photoUrl ? (
            <img className="xp-pro-photo" src={member.photoUrl} alt="" width={56} height={56} loading="lazy" decoding="async" />
          ) : (
            <span className="xp-pro-photo xp-pro-photo--fallback" aria-hidden="true">
              {initials(member.name)}
            </span>
          )}
          <span className="xp-pro-text">
            <span className="xp-choice-name">{member.name}</span>
            <MemberMeta member={member} t={t} language={language} />
            {member.bio ? <span className="xp-choice-desc">{member.bio}</span> : null}
          </span>
          <span className="xp-choice-check" aria-hidden="true">
            <Icon name="check" size={16} />
          </span>
        </button>
      ))}
    </div>
  );
}

/* ---------- 4. Tus datos ---------- */

export interface CustomerForm {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  notes: string;
}

export function DetailsStep({
  profile,
  customer,
  custom,
  errors,
  t,
  onCustomer,
  onCustom,
  orderMode = false,
}: {
  profile: PublicBookingProfile;
  customer: CustomerForm;
  custom: Record<string, string>;
  errors: Record<string, string>;
  t: T;
  onCustomer: (patch: Partial<CustomerForm>) => void;
  onCustom: (key: string, value: string) => void;
  /** Pedido de solo productos: el texto habla de "pedido", no de "cita". */
  orderMode?: boolean;
}) {
  const field = (id: string, label: ReactNode, control: ReactNode, error?: string, hint?: string) => (
    <label className="xp-field" htmlFor={id}>
      <span className="xp-label">{label}</span>
      {control}
      {hint && !error ? <span className="xp-hint">{hint}</span> : null}
      {error ? (
        <span className="xp-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
  const cls = (key: string) => `xp-input${errors[key] ? ' has-error' : ''}`;
  return (
    <div className="xp-stack">
      <p className="xp-hint">{t(orderMode ? 'pub_order_details_hint' : 'pub_details_hint')}</p>
      <div className="xp-grid xp-grid--2">
        {field('xp-first', `${t('pub_first_name')} *`, <input id="xp-first" className={cls('firstName')} value={customer.firstName} onChange={(e) => onCustomer({ firstName: e.target.value })} maxLength={50} autoComplete="given-name" aria-invalid={Boolean(errors.firstName)} />, errors.firstName)}
        {field('xp-last', `${t('pub_last_name')} *`, <input id="xp-last" className={cls('lastName')} value={customer.lastName} onChange={(e) => onCustomer({ lastName: e.target.value })} maxLength={50} autoComplete="family-name" aria-invalid={Boolean(errors.lastName)} />, errors.lastName)}
      </div>
      {field('xp-phone', `${t('phone')} *`, <input id="xp-phone" className={cls('phone')} type="tel" inputMode="tel" value={customer.phone} onChange={(e) => onCustomer({ phone: e.target.value })} maxLength={30} autoComplete="tel" aria-invalid={Boolean(errors.phone)} />, errors.phone, t('pub_phone_hint'))}
      {field('xp-email', t('pub_account_email_label'), <input id="xp-email" className={cls('email')} type="email" inputMode="email" value={customer.email} onChange={(e) => onCustomer({ email: e.target.value })} maxLength={254} autoComplete="email" aria-invalid={Boolean(errors.email)} />, errors.email)}
      {profile.rules.customFields.map((f) =>
        field(
          `xp-custom-${f.key}`,
          `${f.label} ${f.required ? '*' : ''}`.trim(),
          <input id={`xp-custom-${f.key}`} className={cls(`custom.${f.key}`)} type={f.type === 'date' ? 'date' : 'text'} value={custom[f.key] ?? ''} onChange={(e) => onCustom(f.key, e.target.value)} maxLength={200} />,
          errors[`custom.${f.key}`],
        ),
      )}
      {/* Comentarios: opcionales, y solo si el negocio los tiene activados (lo están por defecto). */}
      {profile.features.customerNotes
        ? field('xp-notes', `${t('pub_notes')} (${t('pub_optional')})`, <textarea id="xp-notes" className="xp-textarea" value={customer.notes} onChange={(e) => onCustomer({ notes: e.target.value })} maxLength={500} rows={3} />, undefined, `${t('pub_notes_hint')} · ${t('pub_chars_left', { n: 500 - customer.notes.length })}`)
        : null}
    </div>
  );
}

/* ---------- 5. Resumen ---------- */

export function ReviewStep({
  orderMode = false,
  profile,
  catalog,
  chosen,
  professionalName,
  slot,
  customer,
  totals,
  language,
  t,
  consent,
  errors,
  submitError,
  onConsent,
  website,
  onWebsite,
  onCaptcha,
  discount = null,
  discountSlot,
}: {
  /** Pedido de solo productos: sin profesional ni horario; se recoge y paga en el local. */
  orderMode?: boolean;
  profile: PublicBookingProfile;
  catalog: PublicBookingCatalog;
  chosen: Chosen;
  professionalName: string;
  slot: string | null;
  customer: CustomerForm;
  totals: { minutes: number; price: number };
  language: Language;
  t: T;
  consent: { acceptTerms: boolean; remindersOptIn: boolean };
  errors: Record<string, string>;
  submitError?: string;
  onConsent: (patch: Partial<{ acceptTerms: boolean; remindersOptIn: boolean }>) => void;
  website: string;
  onWebsite: (value: string) => void;
  onCaptcha: (token: string | undefined) => void;
  /** Código de descuento aplicado (Fase 4): el total muestra el ahorro estimado. */
  discount?: AppliedDiscountDto | null;
  /** El campo "¿Tienes un código?" (solo si el negocio usa códigos). */
  discountSlot?: ReactNode;
}) {
  const currency = profile.currency;
  const lines: Array<{ key: string; name: string; price: number }> = [
    ...chosen.services.map((s) => {
      const item = catalog.services.find((i) => i.id === s.itemId);
      const variant = s.variantId ? item?.variants.find((v) => v.id === s.variantId) : undefined;
      return { key: s.itemId, name: variant ? `${item?.name} · ${variant.name}` : (item?.name ?? ''), price: variant?.price ?? item?.price ?? 0 };
    }),
    ...chosen.packages.map((id) => ({ key: id, name: catalog.packages.find((p) => p.id === id)?.name ?? '', price: catalog.packages.find((p) => p.id === id)?.price ?? 0 })),
    ...chosen.products.map((p) => {
      const product = catalog.products.find((i) => i.id === p.itemId);
      return { key: p.itemId, name: `${product?.name ?? ''} ×${p.quantity}`, price: (product?.price ?? 0) * p.quantity };
    }),
  ];
  const day = slot ? upperFirst(formatDay(localDate(slot, profile.timezone), language)) : '';
  const time = slot ? formatClock(localTime(slot, profile.timezone), language) : '';
  const address = [profile.mapAddress || profile.address, profile.mapAddress ? '' : profile.city].filter(Boolean).join(', ');

  return (
    <div className="xp-stack">
      <div className="xp-summary">
        <dl>
          <div>
            <dt>{t(orderMode ? 'pub_order_summary_products' : 'pub_summary_services')}</dt>
            <dd>
              <ul className="xp-summary-lines">
                {lines.map((line) => (
                  <li key={line.key}>
                    <span>{line.name}</span>
                    <span>{money(line.price, currency)}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          {orderMode ? (
            <div>
              <dt>{t('pub_order_pickup')}</dt>
              <dd>{t('pub_order_pickup_value')}</dd>
            </div>
          ) : (
            <>
              <div>
                <dt>{t('pub_summary_professional')}</dt>
                <dd>{professionalName}</dd>
              </div>
              <div>
                <dt>{t('pub_summary_when')}</dt>
                <dd>
                  {t('pub_done_when', { day, time })}
                  <span className="xp-muted xp-nowrap"> · {t('pub_minutes', { minutes: totals.minutes })}</span>
                </dd>
              </div>
            </>
          )}
          {address ? (
            <div>
              <dt>{t('pub_summary_where')}</dt>
              <dd>{address}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('pub_summary_who')}</dt>
            <dd>
              {customer.firstName} {customer.lastName} · {customer.phone}
            </dd>
          </div>
          {customer.notes ? (
            <div>
              <dt>{t('pub_summary_note')}</dt>
              <dd>{customer.notes}</dd>
            </div>
          ) : null}
        </dl>
        <TotalRows total={totals.price} discount={discount} currency={currency} t={t} />
      </div>
      {discountSlot}

      {/* Campo trampa: invisible y fuera del orden de tabulación para una persona; un bot que rellena todo lo encuentra. */}
      <label className="xp-trap" aria-hidden="true">
        Website
        <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => onWebsite(e.target.value)} />
      </label>

      {profile.captchaSiteKey ? <Turnstile siteKey={profile.captchaSiteKey} onToken={onCaptcha} /> : null}

      <label className="xp-check">
        <input type="checkbox" checked={consent.remindersOptIn} onChange={(e) => onConsent({ remindersOptIn: e.target.checked })} />
        <span>{t('pub_reminders_optin')}</span>
      </label>
      <label className="xp-check">
        <input type="checkbox" checked={consent.acceptTerms} onChange={(e) => onConsent({ acceptTerms: e.target.checked })} aria-invalid={Boolean(errors.acceptTerms)} />
        <span>{t('pub_accept_terms')}</span>
      </label>
      {errors.acceptTerms ? (
        <p className="xp-error" role="alert">
          {errors.acceptTerms}
        </p>
      ) : null}
      {profile.conditions ? (
        <details className="xp-legal">
          <summary>{t('pub_conditions_link')}</summary>
          <p>{profile.conditions}</p>
        </details>
      ) : null}
      {profile.privacyPolicy ? (
        <details className="xp-legal">
          <summary>{t('pub_privacy_link')}</summary>
          <p>{profile.privacyPolicy}</p>
        </details>
      ) : null}
      {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
    </div>
  );
}
