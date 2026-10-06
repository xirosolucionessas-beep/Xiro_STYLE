import { translate, type Language } from '@xiro/shared';
import { useEffect, useRef, useState } from 'react';
import { publicApi } from '../api';
import { BookingFlow, type InitialChoice } from '../booking/BookingFlow';
import { useInView } from '../lib/useInView';
import { errorKey, useAsync } from '../lib/useAsync';
import { replacePath, profilePath } from '../lib/route';
import { GallerySection } from '../profile/GallerySection';
import { Hero } from '../profile/Hero';
import { HoursSection } from '../profile/HoursSection';
import { ProductsSection } from '../profile/ProductsSection';
import { ReviewsSection } from '../profile/ReviewsSection';
import { ServicesSection } from '../profile/ServicesSection';
import { StickyBook } from '../profile/StickyBook';
import { TeamSection } from '../profile/TeamSection';
import { LocationCard } from '../ui/LocationCard';
import { ProfileSkeleton } from '../ui/Skeleton';

/**
 * Página pública de reservas de un negocio (/reservar/:slug). Orden: encabezado, sobre el negocio, Servicios, Profesionales,
 * Galería, Productos, Reseñas, Horarios y Ubicación y contacto. Una sección sin contenido, o apagada en "Mi página web",
 * no se dibuja. Sin sesión: cualquier persona puede reservar.
 */
export function ProfilePage({ slug, language }: { slug: string; language: Language }) {
  const t = (key: string, params?: Record<string, string | number>) => translate(language, key, params);
  const profileState = useAsync(() => publicApi.profile(slug), [slug]);
  const [booking, setBooking] = useState<InitialChoice | null>(null);
  const heroCta = useRef<HTMLDivElement>(null);
  const heroCtaVisible = useInView(heroCta);

  // Dirección anterior del negocio: la API la resuelve igual, pero la barra de direcciones debe mostrar la vigente.
  useEffect(() => {
    if (profileState.data && profileState.data.slug !== slug) replacePath(profilePath(profileState.data.slug));
  }, [profileState.data, slug]);

  const profile = profileState.data;
  const currentSlug = profile?.slug ?? slug;
  const sections = profile?.sections;
  const catalogState = useAsync(() => (sections?.services || sections?.products ? publicApi.catalog(currentSlug) : Promise.resolve(null)), [currentSlug, sections?.services, sections?.products]);
  const teamState = useAsync(() => (sections?.team ? publicApi.team(currentSlug) : Promise.resolve([])), [currentSlug, sections?.team]);
  const reviewsState = useAsync(() => (sections?.reviews ? publicApi.reviews(currentSlug) : Promise.resolve([])), [currentSlug, sections?.reviews]);

  useEffect(() => {
    if (profile) document.title = `${profile.name} · ${t('pub_book_cta')}`;
  }, [profile?.name, language]); // eslint-disable-line react-hooks/exhaustive-deps

  if (profileState.loading) return <ProfileSkeleton label={t('loading')} />;
  if (profileState.error || !profile) {
    return (
      <div className="xp-empty" role="alert">
        <h1>{t('pub_page_not_found_title')}</h1>
        <p>{t('pub_page_not_found_text')}</p>
      </div>
    );
  }

  const catalog = catalogState.data ?? null;
  const hasLocation = (profile.latitude !== null && profile.longitude !== null) || Boolean(profile.address || profile.whatsapp || profile.phone);
  const openFlow = (choice: InitialChoice = {}) => setBooking(choice);

  return (
    <div className="xp-page">
      <a className="xp-skip" href="#xp-main">
        {t('pub_skip_to_content')}
      </a>
      <Hero profile={profile} language={language} onBook={() => openFlow()} ctaRef={heroCta} />
      <main id="xp-main" className="xp-main">
        <div className="xp-container">
          {profile.description ? (
            <section className="xp-section xp-about" aria-label={profile.name}>
              <p>{profile.description}</p>
            </section>
          ) : null}

          {sections?.services ? <ServicesSection profile={profile} catalog={catalog} loading={catalogState.loading} language={language} onBook={openFlow} /> : null}
          {sections?.team ? <TeamSection team={teamState.data ?? []} services={catalog?.services ?? []} language={language} /> : null}
          {sections?.gallery ? <GallerySection photos={profile.gallery} language={language} /> : null}
          {sections?.products && catalog ? <ProductsSection profile={profile} products={catalog.products} language={language} onBook={openFlow} /> : null}
          {sections?.reviews ? <ReviewsSection reviews={reviewsState.data ?? []} language={language} /> : null}
          <HoursSection profile={profile} language={language} />

          {hasLocation ? (
            <section className="xp-section" id="ubicacion" aria-labelledby="xp-location-h">
              <h2 id="xp-location-h">{t('pub_nav_location')}</h2>
              <LocationCard profile={profile} language={language} />
            </section>
          ) : null}
        </div>
      </main>

      <footer className="xp-footer">
        <p>{t('pub_footer_rights', { year: new Date().getFullYear(), name: profile.name })}</p>
        <p>{t('pub_footer_powered')}</p>
      </footer>

      {profile.acceptsBookings ? <StickyBook visible={!heroCtaVisible && !booking} language={language} onBook={() => openFlow()} /> : null}

      {booking ? <BookingFlow slug={currentSlug} profile={profile} catalog={catalog ?? { services: [], packages: [], products: [] }} catalogLoading={catalogState.loading} team={teamState.data ?? []} language={language} initial={booking} onClose={() => setBooking(null)} /> : null}
      {catalogState.error ? (
        <p className="xp-sr" role="alert">
          {t(errorKey(catalogState.error))}
        </p>
      ) : null}
    </div>
  );
}
