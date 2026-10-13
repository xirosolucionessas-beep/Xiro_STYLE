import { translate, type Language, type PublicBookingCatalog, type PublicBookingProfile } from '@xiro/shared';
import { useState } from 'react';
import { money } from '../lib/format';
import { Icon } from '../ui/Icon';
import { ItemDetailModal, type DetailItem } from './ItemDetailModal';

type Product = PublicBookingCatalog['products'][number];

function detailFromProduct(product: Product): DetailItem {
  return {
    id: product.id,
    name: product.name,
    description: [product.fullDescription, product.description].find((d) => d && d !== product.name && !/^[\d\s.,-]+$/.test(d)) ?? '',
    detail: product.detail ?? '',
    images: product.images,
    price: product.price,
  };
}

/** Productos con su imagen (recortada a proporción fija), nombre, descripción legible y precio formateado. Los agotados se ven, pero atenuados y rotulados.
 * Tocar la tarjeta abre el detalle con todas las fotos; desde ahí "Reservar" agrega el producto y abre el flujo. */
export function ProductsSection({
  profile,
  products,
  language,
  onBook,
  initialOpenId,
  onDetailClose,
}: {
  profile: PublicBookingProfile;
  products: PublicBookingCatalog['products'];
  language: Language;
  onBook: (choice: { productId: string }) => void;
  /** Enlace directo a un producto: su detalle abre solo. */
  initialOpenId?: string;
  onDetailClose?: () => void;
}) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  if (products.length === 0) return null;
  const openProduct = openId ? products.find((p) => p.id === openId) : null;

  return (
    <section className="xp-section" id="productos" aria-labelledby="xp-products-h">
      <p className="xp-kicker" aria-hidden="true">
        {t('pub_kicker_products')}
      </p>
      <h2 id="xp-products-h">{t('pub_nav_products')}</h2>
      <ul className="xp-product-grid">
        {products.map((product) => {
          // La descripción es texto libre del negocio; si es solo un número o repite el nombre no aporta nada y no se muestra.
          const description = product.description && product.description !== product.name && !/^[\d\s.,-]+$/.test(product.description) ? product.description : '';
          return (
            <li key={product.id} className={`xp-product${product.inStock ? '' : ' is-out'}`}>
              <button type="button" className="xp-product-open" aria-label={t('pub_detail_open', { name: product.name })} onClick={() => setOpenId(product.id)}>
                {product.image ? (
                  <img className="xp-product-img" src={product.image} alt="" width={400} height={400} loading="lazy" decoding="async" />
                ) : (
                  <span className="xp-product-img xp-product-img--empty" aria-hidden="true">
                    <Icon name="image" size={28} />
                  </span>
                )}
                <span className="xp-product-body">
                  <span className="xp-product-name">{product.name}</span>
                  {description ? <span className="xp-product-desc">{description}</span> : null}
                  <span className="xp-product-foot">
                    <span className="xp-price">{money(product.price, profile.currency)}</span>
                    {!product.inStock ? <span className="xp-tag xp-tag--muted">{t('pub_out_of_stock')}</span> : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {openProduct ? (
        <ItemDetailModal
          item={detailFromProduct(openProduct)}
          currency={profile.currency}
          language={language}
          canBook={(profile.acceptsBookings || profile.acceptsProductOrders) && openProduct.inStock}
          ctaLabel={profile.acceptsBookings ? undefined : t('pub_order_book')}
          onClose={() => {
            setOpenId(null);
            onDetailClose?.();
          }}
          onBook={() => {
            setOpenId(null);
            onBook({ productId: openProduct.id });
          }}
        />
      ) : null}
    </section>
  );
}
