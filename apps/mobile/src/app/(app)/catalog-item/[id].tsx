import { formatMoney } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Linking } from 'react-native';
import { publicItemUrl } from '@/lib/api';
import { useItem } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { Gallery } from '@/ui/Gallery';
import { EmptyState } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

/** Vista previa de lo que ve el cliente en el catálogo público (sin costos ni stock). */
export default function CatalogItemDetail() {
  const router = useRouter();
  const { t } = useSettings();
  const { business } = useAuthed();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item, isPending } = useItem(id);

  if (isPending) return <Screen header={<Header title={t('catalog')} />}><ActivityIndicator style={{ marginTop: 40 }} /></Screen>;
  if (!item) return <Screen header={<Header title={t('catalog')} />}><EmptyState icon="book-outline" message={t('not_found')} /></Screen>;

  const publicUrl = publicItemUrl(business.slug, item.id);

  return (
    <Screen header={<Header title={t('catalog')} />}>
      <Gallery urls={item.photos.slice(0, 4).map((p) => p.url)} icon="cut-outline" />
      <AppText variant="title" style={{ marginTop: 20 }}>
        {item.name}
      </AppText>
      <AppText tone="gold" variant="bodyStrong" style={{ marginTop: 6 }}>
        {item.categoryName}
      </AppText>
      <AppText tone="muted" style={{ marginTop: 14 }}>
        {item.description || item.shortDescription}
      </AppText>
      {item.detail ? <AppText style={{ marginTop: 14 }}>{item.detail}</AppText> : null}
      <AppText variant="display" tone="gold" style={{ marginTop: 12 }}>
        {formatMoney(item.price, business.currency)}
      </AppText>
      {!item.published ? (
        <AppText variant="small" tone="muted" style={{ marginTop: 6 }}>
          {t('hidden_from_catalog')}
        </AppText>
      ) : null}

      <Button label={t('item_edit')} variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: '/item/form', params: { id: item.id } })} style={{ marginTop: 24 }} />
      <Button label={t('share_whatsapp')} icon="logo-whatsapp" onPress={() => router.push({ pathname: '/share', params: { mode: 'item', id: item.id } })} style={{ marginTop: 10 }} />
      {item.published ? <Button label="Web" variant="ghost" icon="open-outline" onPress={() => void Linking.openURL(publicUrl)} style={{ marginTop: 6 }} /> : null}
    </Screen>
  );
}
