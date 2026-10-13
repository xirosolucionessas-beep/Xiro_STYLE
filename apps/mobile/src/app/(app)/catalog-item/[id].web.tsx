/**
 * Ruta /catalog-item/[id] SOLO WEB (nativo: catalog-item/[id].tsx, sin cambios). Ficha de servicio con la galería nueva
 * (sección 7). Presentación en src/web/screens/ServiceDetail.tsx.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { publicItemUrl, resolveMedia } from '@/lib/api';
import { useItem, useVariants } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { ServiceDetailView } from '@/web/screens/ServiceDetail';
import { useWebText } from '@/web/services/useWebText';

export default function CatalogItemDetailWeb() {
  const router = useRouter();
  const { t } = useWebText();
  const { business } = useAuthed();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item, isPending } = useItem(id);
  // Estilos/variantes reales (solo servicios) para que la vista previa muestre lo mismo que la página pública.
  const variants = useVariants(item?.kind === 'service' ? item.id : undefined);

  if (isPending) {
    return (
      <Screen header={<Header title={t('catalog')} />}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen header={<Header title={t('catalog')} />}>
        <EmptyState icon="book-outline" message={t('not_found')} />
      </Screen>
    );
  }

  const photos = item.photos
    .slice(0, 4)
    .map((photo) => resolveMedia(photo.url))
    .filter((url): url is string => Boolean(url));

  return (
    <Screen header={<Header title={item.name} subtitle={item.categoryName} />}>
      <ServiceDetailView
        t={t}
        item={{
          id: item.id,
          name: item.name,
          categoryName: item.categoryName,
          description: item.description,
          shortDescription: item.shortDescription,
          detail: item.detail,
          price: item.price,
          published: item.published,
          photos,
          durationMinutes: item.kind === 'service' ? item.durationMinutes : null,
          variants: (variants.data ?? []).filter((v) => v.active).map((v) => ({ id: v.id, name: v.name, price: v.price, durationMinutes: v.durationMinutes })),
        }}
        currency={business.currency}
        publicUrl={publicItemUrl(business.slug, item.id)}
        onEdit={() => router.push({ pathname: '/item/form', params: { id: item.id } })}
        onShare={() => router.push({ pathname: '/share', params: { mode: 'item', id: item.id } })}
      />
    </Screen>
  );
}
