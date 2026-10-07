import { formatMoney, type Currency } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { actorOf, meets } from '@/lib/access';
import { errorKey, publicBaseUrl, resolveMedia } from '@/lib/api';
import { businessAddressLine } from '@/lib/exports/address';
import { buildCatalogPdf, catalogPdfFileName, type CatalogPdfItem } from '@/lib/exports/catalogPdf';
import { imageDataUrl, shareGeneratedFile } from '@/lib/exports/nativeFiles';
import { qrPngDataUrl } from '@/lib/exports/qrPng';
import { useBookingSettings, useCategories, useItems } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { CatalogCard, ItemGrid } from '@/ui/ItemCards';
import { Chip, ChipRow, EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

/** Ejecuta `task` sobre cada elemento con como mucho `limit` a la vez (las fotos se procesan sin saturar la memoria del teléfono). */
async function mapLimit<T, R>(list: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await task(list[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}

/**
 * Catálogo en Android/iOS (en la Web: catalog.web.tsx). Mismas acciones que la web: filtro por categoría, enviar el
 * catálogo, descargar el catálogo en PDF (mismo generador que la web, `lib/exports/catalogPdf`, con el mismo filtro y solo
 * lo publicado) y, con permiso de gestionar el catálogo, agregar artículos y administrar categorías.
 */
export default function Catalog() {
  const router = useRouter();
  const { colors, t } = useSettings();
  const { user, business } = useAuthed();
  const { toast } = useDialogs();
  const canManage = meets(actorOf(user), ['catalog_manage']);
  const items = useItems();
  const categories = useCategories();
  const bookingSettings = useBookingSettings();
  const [category, setCategory] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const currency = business.currency as Currency;

  const visible = useMemo(() => (items.data ?? []).filter((item) => !category || item.categoryId === category), [items.data, category]);

  /**
   * Mismo criterio que la web: EXACTAMENTE el filtro de categoría de la pantalla y solo artículos publicados (lo que el
   * dueño ya decidió mostrar afuera). El archivo se guarda o comparte desde la hoja del sistema.
   */
  async function exportCatalogPdf() {
    setExportingPdf(true);
    try {
      const categoryLabel = category ? (categories.data ?? []).find((c) => c.id === category)?.name : undefined;
      const published = (items.data ?? []).filter((item) => item.published && (!category || item.categoryId === category));
      const profile = bookingSettings.data?.profile;
      const bookingUrl = profile?.published ? `${publicBaseUrl()}/catalog/${business.slug}` : null;

      const logoDataUrl = await imageDataUrl(resolveMedia(business.logoUrl), 600);
      const photos = published.flatMap((item, itemIndex) => item.photos.map((photo) => ({ itemIndex, url: resolveMedia(photo.url) })));
      const loaded = await mapLimit(photos, 3, (photo) => imageDataUrl(photo.url));
      const pdfItems: CatalogPdfItem[] = published.map((item, index) => ({
        name: item.name,
        categoryLabel: item.categoryName,
        description: item.description || item.shortDescription,
        priceLabel: formatMoney(item.price, currency),
        durationMinutes: item.kind === 'service' ? item.durationMinutes : null,
        imageDataUrls: photos.map((photo, at) => (photo.itemIndex === index ? loaded[at] : null)).filter((url): url is string => Boolean(url)),
      }));

      const social = [profile?.instagram ? `Instagram: ${profile.instagram}` : null, profile?.facebook ? `Facebook: ${profile.facebook}` : null, profile?.tiktok ? `TikTok: ${profile.tiktok}` : null, profile?.website || null].filter((line): line is string => Boolean(line));
      const filterLabel = categoryLabel ? t('catalog_pdf_filter', { category: categoryLabel }) : null;

      const doc = buildCatalogPdf({
        businessName: business.name,
        tagline: profile?.tagline ?? '',
        logoDataUrl,
        whatsapp: business.whatsapp,
        phone: profile?.phone || null,
        address: businessAddressLine(business.address, business.city, business.country),
        social,
        filterLabel,
        items: pdfItems,
        bookingUrl,
        qrDataUrl: qrPngDataUrl(bookingUrl),
      });
      const result = await shareGeneratedFile(catalogPdfFileName(business.name, filterLabel), new Uint8Array(doc.output('arraybuffer')), 'pdf', t('catalog_export_pdf'));
      if (result === 'unavailable') toast(t('rep_share_unavailable'));
    } catch {
      toast(t('rep_export_failed'));
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <Screen
      refreshing={items.isRefetching}
      onRefresh={() => void items.refetch()}
      header={
        <Header
          root
          title={t('catalog')}
          subtitle={t('catalog_sub')}
          right={
            canManage ? (
              <Pressable accessibilityRole="button" onPress={() => router.push('/categories')} hitSlop={8}>
                <AppText variant="label" tone="gold">
                  {t('categories')}
                </AppText>
              </Pressable>
            ) : undefined
          }
        />
      }
      footer={<Button label={t('send_catalog')} icon="send" onPress={() => router.push({ pathname: '/share', params: { mode: 'catalog' } })} />}>
      <ChipRow label={t('filter_category')}>
        <Chip label={t('all')} selected={category === null} onPress={() => setCategory(null)} />
        {categories.data?.map((c) => (
          <Chip key={c.id} label={c.name} selected={category === c.id} onPress={() => setCategory(c.id)} />
        ))}
      </ChipRow>

      <View style={styles.actions}>
        <Button label={t('catalog_export_pdf')} variant="secondary" icon="document-text-outline" loading={exportingPdf} disabled={!items.data || items.data.length === 0} onPress={() => void exportCatalogPdf()} />
        {canManage ? <Button label={t('add_to_catalog')} variant="secondary" icon="add" onPress={() => router.push('/item/form')} /> : null}
      </View>

      {items.isPending ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
      ) : items.isError ? (
        <View style={{ alignItems: 'center', gap: 12, marginTop: 24 }}>
          <AppText tone="danger" center>
            {t(errorKey(items.error))}
          </AppText>
          <Button label={t('retry')} variant="secondary" compact onPress={() => void items.refetch()} />
        </View>
      ) : visible.length === 0 ? (
        <EmptyState icon="book-outline" message={t('no_items')} />
      ) : (
        <ItemGrid>
          {visible.map((item) => (
            <CatalogCard key={item.id} item={item} currency={business.currency} onPress={() => router.push({ pathname: '/catalog-item/[id]', params: { id: item.id } })} />
          ))}
        </ItemGrid>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10, marginVertical: 14 },
});
