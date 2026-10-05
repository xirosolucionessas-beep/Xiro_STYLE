/**
 * Ruta /catalog SOLO WEB (nativo: catalog.tsx, sin cambios). Mismos datos y acciones (filtro por categoría, agregar,
 * categorías, enviar catálogo); la presentación está en src/web/screens/Catalog.tsx.
 */
import { formatMoney, type Currency } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { actorOf, meets } from '@/lib/access';
import { errorKey, publicBaseUrl, resolveMedia } from '@/lib/api';
import { catalogStats } from '@/lib/sections';
import { useBookingSettings, useCategories, useItems } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { Ico } from '@/web/icons';
import { businessAddressLine, toDataUrl } from '@/web/services/invoicePdf';
import { downloadCatalogPdf, toQrDataUrl, type CatalogPdfItem } from '@/web/services/catalogPdf';
import { CatalogView, type CatalogCardView } from '@/web/screens/Catalog';
import { useWebText } from '@/web/services/useWebText';
import { Button } from '@/web/ui/Button';
import type { KpiView } from '@/web/ui/Page';

export default function CatalogWeb() {
  const router = useRouter();
  const { t } = useWebText();
  const { user, business } = useAuthed();
  const canManage = meets(actorOf(user), ['catalog_manage']);
  const items = useItems();
  const categories = useCategories();
  const bookingSettings = useBookingSettings();
  const [category, setCategory] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const currency = business.currency as Currency;

  const cards = useMemo<CatalogCardView[]>(
    () =>
      (items.data ?? [])
        .filter((item) => !category || item.categoryId === category)
        .map((item) => ({ id: item.id, name: item.name, description: item.shortDescription, price: formatMoney(item.price, currency), photo: resolveMedia(item.photos[0]?.url) ?? null, published: item.published, href: `/catalog-item/${item.id}` })),
    [items.data, category, currency],
  );

  const stats = items.data ? catalogStats(items.data) : null;
  const kpis: KpiView[] = [
    { id: 'total', icon: 'book-open', label: t('sec_kpi_services_total'), value: stats ? String(stats.total) : '—', loading: items.isLoading },
    { id: 'published', icon: 'eye', label: t('sec_kpi_published'), value: stats ? String(stats.published) : '—', loading: items.isLoading },
    { id: 'hidden', icon: 'eye-off', label: t('sec_kpi_hidden'), value: stats ? String(stats.hidden) : '—', loading: items.isLoading },
    { id: 'avg', icon: 'coins', label: t('sec_kpi_avg_price'), value: stats?.averagePrice != null ? formatMoney(stats.averagePrice, currency) : '—', loading: items.isLoading },
  ];

  const add = () => router.push('/item/form');

  /**
   * Catálogo PDF (sección 2): usa EXACTAMENTE el mismo filtro de categoría que la pantalla (`category`) y solo
   * artículos publicados — igual límite que ya respeta la página pública del catálogo, nunca se filtra algo distinto
   * de lo que el dueño ya decidió mostrar afuera.
   */
  async function exportCatalogPdf() {
    setExportingPdf(true);
    try {
      const categoryLabel = category ? (categories.data ?? []).find((c) => c.id === category)?.name : undefined;
      const published = (items.data ?? []).filter((item) => item.published && (!category || item.categoryId === category));
      const profile = bookingSettings.data?.profile;
      const bookingUrl = profile?.published ? `${publicBaseUrl()}/catalog/${business.slug}` : null;

      const [logoDataUrl, qrDataUrl, itemImages] = await Promise.all([
        toDataUrl(resolveMedia(business.logoUrl)),
        toQrDataUrl(bookingUrl),
        Promise.all(published.map((item) => toDataUrl(resolveMedia(item.photos[0]?.url)))),
      ]);

      const pdfItems: CatalogPdfItem[] = published.map((item, index) => ({
        name: item.name,
        categoryLabel: item.categoryName,
        description: item.shortDescription,
        priceLabel: formatMoney(item.price, currency),
        imageDataUrl: itemImages[index] ?? null,
      }));

      const social = [profile?.instagram ? `Instagram: ${profile.instagram}` : null, profile?.facebook ? `Facebook: ${profile.facebook}` : null, profile?.tiktok ? `TikTok: ${profile.tiktok}` : null, profile?.website || null].filter((line): line is string => Boolean(line));

      downloadCatalogPdf({
        businessName: business.name,
        tagline: profile?.tagline ?? '',
        logoDataUrl,
        whatsapp: business.whatsapp,
        phone: profile?.phone || null,
        address: businessAddressLine(business.address, business.city, business.country),
        social,
        filterLabel: categoryLabel ? t('catalog_pdf_filter', { category: categoryLabel }) : null,
        items: pdfItems,
        bookingUrl,
        qrDataUrl,
      });
    } finally {
      setExportingPdf(false);
    }
  }
  return (
    <Screen
      header={
        <Header
          root
          title={t('catalog')}
          subtitle={t('catalog_sub')}
          right={
            <>
              {canManage ? (
                <Button variant="secondary" icon={<Ico name="tag" size={18} />} onPress={() => router.push('/categories')}>
                  {t('categories')}
                </Button>
              ) : null}
              <Button variant="secondary" icon={<Ico name="send" size={18} />} onPress={() => router.push({ pathname: '/share', params: { mode: 'catalog' } })}>
                {t('send_catalog')}
              </Button>
              <Button variant="secondary" icon={<Ico name="download" size={18} />} loading={exportingPdf} loadingLabel={t('loading')} onPress={() => void exportCatalogPdf()}>
                {t('catalog_export_pdf')}
              </Button>
              {canManage ? (
                <Button icon={<Ico name="plus" size={18} />} onPress={add}>
                  {t('add_to_catalog')}
                </Button>
              ) : null}
            </>
          }
        />
      }>
      <CatalogView
        t={t}
        kpis={kpis}
        categories={(categories.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
        category={category}
        onCategory={setCategory}
        cards={cards}
        state={items.isPending ? 'loading' : items.isError ? 'error' : 'ready'}
        errorMessage={items.isError ? t(errorKey(items.error)) : undefined}
        onRetry={() => void items.refetch()}
        emptyAction={
          canManage ? (
            <Button icon={<Ico name="plus" size={18} />} onPress={add}>
              {t('add_to_catalog')}
            </Button>
          ) : undefined
        }
        navigate={(href) => router.push(href as never)}
      />
    </Screen>
  );
}
