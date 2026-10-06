import { translate, type Language, type PublicBookingCatalog, type PublicBookingProfile } from '@xiro/shared';
import { money } from '../lib/format';
import { Icon } from '../ui/Icon';

/** Productos con su imagen (recortada a proporción fija), nombre, descripción legible y precio formateado. Los agotados se ven, pero atenuados y rotulados. */
export function ProductsSection({ profile, products, language }: { profile: PublicBookingProfile; products: PublicBookingCatalog['products']; language: Language }) {
  const t = (key: string) => translate(language, key);
  if (products.length === 0) return null;
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
              {product.image ? (
                <img className="xp-product-img" src={product.image} alt="" width={400} height={400} loading="lazy" decoding="async" />
              ) : (
                <span className="xp-product-img xp-product-img--empty" aria-hidden="true">
                  <Icon name="image" size={28} />
                </span>
              )}
              <div className="xp-product-body">
                <h3 className="xp-product-name">{product.name}</h3>
                {description ? <p className="xp-product-desc">{description}</p> : null}
                <div className="xp-product-foot">
                  <span className="xp-price">{money(product.price, profile.currency)}</span>
                  {!product.inStock ? <span className="xp-tag xp-tag--muted">{t('pub_out_of_stock')}</span> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
