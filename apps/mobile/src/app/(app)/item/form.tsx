import { Ionicons } from '@expo/vector-icons';
import { itemInputSchema, MAX_PHOTOS_PER_ITEM, STOCK_STATUSES, suggestStockStatus, type ItemInput, type StockStatus } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { apiErrors, issuesToErrors, toInt } from '@/lib/forms';
import { pickFromLibrary, takePhoto, uploadableImage, type PickedImage } from '@/lib/images';
import { useCategories, useInvalidateCatalog, useItem } from '@/lib/queries';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { VariantsSection } from '@/ui/booking/VariantsSection';
import { Field } from '@/ui/Field';
import { Chip, ChipRow, Photo, SectionTitle, stockColor, Toggle } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';

interface PhotoEntry {
  key: string;
  url?: string;
  id?: string;
  local?: PickedImage;
}

let keyCounter = 0;
const nextKey = () => `photo-${(keyCounter += 1)}`;

export default function ItemForm() {
  const router = useRouter();
  const { t, colors } = useSettings();
  const { toast } = useDialogs();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useItem(id).data;
  const categories = useCategories().data ?? [];
  const invalidate = useInvalidateCatalog();

  const [form, setForm] = useState({ name: '', shortDescription: '', description: '', detail: '', price: '', referenceCode: '', cost: '', stock: '0', notes: '' });
  const [categoryId, setCategoryId] = useState('');
  const [published, setPublished] = useState(true);
  const [kind, setKind] = useState<'service' | 'product'>('service');
  const [bookable, setBookable] = useState(true);
  const [minutes, setMinutes] = useState('30');
  const [cleanup, setCleanup] = useState('0');
  const [status, setStatus] = useState<StockStatus>('out_of_stock');
  const [statusTouched, setStatusTouched] = useState(false);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);
  const savedId = useRef<string | undefined>(undefined);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!existing || hydrated.current) return;
    hydrated.current = true;
    setForm({
      name: existing.name,
      shortDescription: existing.shortDescription,
      description: existing.description,
      detail: existing.detail,
      price: String(existing.price),
      referenceCode: existing.referenceCode,
      cost: existing.internalUnitCost ? String(existing.internalUnitCost) : '',
      stock: String(existing.stock),
      notes: existing.internalNotes,
    });
    setCategoryId(existing.categoryId);
    setPublished(existing.published);
    setKind(existing.kind);
    setBookable(existing.bookable);
    setMinutes(String(existing.durationMinutes));
    setCleanup(String(existing.cleanupMinutes));
    setStatus(existing.stockStatus);
    setStatusTouched(true);
    setPhotos(existing.photos.map((p) => ({ key: p.id, id: p.id, url: p.url })));
  }, [existing]);

  useEffect(() => {
    if (!categoryId && !id && categories[0]) setCategoryId(categories[0].id);
  }, [categories, categoryId, id]);

  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const digits = (key: 'price' | 'cost' | 'stock') => (value: string) => {
    const clean = value.replace(/\D/g, '');
    setForm((current) => ({ ...current, [key]: clean }));
    if (key === 'stock' && !statusTouched) setStatus(suggestStockStatus(toInt(clean)));
  };

  const suggested = suggestStockStatus(toInt(form.stock));
  const room = MAX_PHOTOS_PER_ITEM - photos.length;

  async function addFromLibrary() {
    const picked = await pickFromLibrary(room);
    setPhotos((current) => [...current, ...picked.map((image) => ({ key: nextKey(), url: image.uri, local: image }))].slice(0, MAX_PHOTOS_PER_ITEM));
  }
  async function addFromCamera() {
    const picked = await takePhoto();
    if (picked) setPhotos((current) => [...current, { key: nextKey(), url: picked.uri, local: picked }].slice(0, MAX_PHOTOS_PER_ITEM));
  }
  const makeMain = (key: string) => setPhotos((current) => [...current.filter((p) => p.key === key), ...current.filter((p) => p.key !== key)]);
  const removePhoto = (entry: PhotoEntry) => {
    if (entry.id) setRemoved((current) => [...current, entry.id!]);
    setPhotos((current) => current.filter((p) => p.key !== entry.key));
  };

  async function submit() {
    setGeneral(undefined);
    const body: ItemInput = {
      name: form.name,
      categoryId,
      shortDescription: form.shortDescription,
      description: form.description,
      detail: form.detail,
      price: toInt(form.price),
      published,
      kind,
      bookable,
      ...(kind === 'service' ? { durationMinutes: toInt(minutes), cleanupMinutes: toInt(cleanup) } : {}),
      referenceCode: form.referenceCode,
      internalUnitCost: toInt(form.cost),
      stock: toInt(form.stock),
      stockStatus: status,
      internalNotes: form.notes,
    };
    const parsed = itemInputSchema.safeParse(body);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, t));
    if (!form.price) return setErrors({ price: t('required') });
    setErrors({});
    setBusy(true);

    try {
      const targetId = existing?.id ?? savedId.current;
      let saved = targetId ? await api.updateItem(targetId, body) : await api.createItem(body);
      savedId.current = saved.id;

      for (const photoId of removed) saved = await api.deletePhoto(saved.id, photoId);
      setRemoved([]);

      const working = photos.map((p) => ({ ...p }));
      for (const entry of working) {
        if (!entry.local) continue;
        const before = new Set(saved.photos.map((p) => p.id));
        saved = await api.addPhoto(saved.id, await uploadableImage(entry.local));
        const added = saved.photos.find((p) => !before.has(p.id));
        setPhotos((current) => current.map((p) => (p.key === entry.key ? { key: p.key, id: added?.id, url: added?.url } : p)));
        entry.id = added?.id;
        entry.local = undefined;
      }

      const mainId = working[0]?.id;
      if (mainId && saved.photos[0]?.id !== mainId) saved = await api.makePrimaryPhoto(saved.id, mainId);

      await invalidate();
      toast(t('saved'));
      router.back();
    } catch (error) {
      const result = apiErrors(error, t);
      setErrors(result.fields);
      setGeneral(result.general);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<Header title={id ? t('item_edit') : t('item_new')} />}>
      <SectionTitle>{t('section_public')}</SectionTitle>
      <Field label={`${t('item_name')} *`} value={form.name} onChangeText={set('name')} error={errors.name} maxLength={80} />

      <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
        {t('item_category')} *
      </AppText>
      {categories.length === 0 ? (
        <Button label={t('create_category_first')} variant="secondary" compact onPress={() => router.push('/categories')} />
      ) : (
        <ChipRow label={t('item_category')}>
          {categories.map((c) => (
            <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
          ))}
        </ChipRow>
      )}
      {errors.categoryId ? (
        <AppText variant="small" tone="danger" style={{ marginTop: 4 }}>
          {errors.categoryId}
        </AppText>
      ) : null}

      <View style={{ height: 14 }} />
      <Field label={t('item_short')} value={form.shortDescription} onChangeText={set('shortDescription')} error={errors.shortDescription} maxLength={120} />
      <Field label={t('item_description')} value={form.description} onChangeText={set('description')} error={errors.description} multiline maxLength={1500} />
      <Field label={t('item_detail')} value={form.detail} onChangeText={set('detail')} error={errors.detail} placeholder={t('item_detail_hint')} maxLength={60} />
      <Field label={`${t('item_price')} *`} value={form.price} onChangeText={digits('price')} error={errors.price} keyboardType="number-pad" prefix="$" />

      <View style={styles.switchRow}>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {t('item_published')}
        </AppText>
        <Toggle value={published} onChange={setPublished} label={t('item_published')} />
      </View>

      <SectionTitle>{t('item_booking_section')}</SectionTitle>
      <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
        {t('item_kind')} *
      </AppText>
      <ChipRow label={t('item_kind')}>
        <Chip label={t('kind_service')} selected={kind === 'service'} onPress={() => setKind('service')} />
        <Chip label={t('kind_product')} selected={kind === 'product'} onPress={() => setKind('product')} />
      </ChipRow>
      <AppText variant="small" tone="muted" style={{ marginTop: 6, marginBottom: 10 }}>
        {kind === 'service' ? t('item_kind_service_hint') : t('item_kind_product_hint')}
      </AppText>
      {kind === 'service' ? (
        <>
          <Field label={`${t('item_duration')} *`} value={minutes} onChangeText={(v) => setMinutes(v.replace(/\D/g, ''))} error={errors.durationMinutes} keyboardType="number-pad" hint={t('item_duration_hint')} maxLength={3} />
          <Field label={t('item_cleanup')} value={cleanup} onChangeText={(v) => setCleanup(v.replace(/\D/g, ''))} error={errors.cleanupMinutes} keyboardType="number-pad" hint={t('item_cleanup_hint')} maxLength={3} />
        </>
      ) : null}
      <View style={styles.switchRow}>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {kind === 'service' ? t('item_bookable_service') : t('item_bookable_product')}
        </AppText>
        <Toggle value={bookable} onChange={setBookable} label={kind === 'service' ? t('item_bookable_service') : t('item_bookable_product')} />
      </View>
      {id && kind === 'service' ? <VariantsSection itemId={id} basePrice={toInt(form.price)} baseMinutes={toInt(minutes) || 30} canManage /> : null}

      <SectionTitle>{t('photos')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 10 }}>
        {t('photos_hint')}
      </AppText>
      <View style={styles.photoRow}>
        {photos.map((entry, index) => (
          <View key={entry.key}>
            <Pressable accessibilityRole="button" onPress={() => makeMain(entry.key)} style={[styles.thumb, { borderColor: index === 0 ? colors.gold : colors.border }]}>
              <Photo url={entry.url} size={76} style={{ borderRadius: 0 }} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('delete')} onPress={() => removePhoto(entry)} style={[styles.remove, { backgroundColor: colors.danger }]} hitSlop={6}>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        ))}
      </View>
      {errors.photos ? (
        <AppText variant="small" tone="danger">
          {errors.photos}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Button label={t('gallery')} icon="images-outline" variant="secondary" compact disabled={room <= 0} onPress={addFromLibrary} style={{ flex: 1 }} />
        <Button label={t('camera')} icon="camera-outline" variant="secondary" compact disabled={room <= 0} onPress={addFromCamera} style={{ flex: 1 }} />
      </View>

      <SectionTitle>{t('section_internal')}</SectionTitle>
      <Field label={t('item_code')} value={form.referenceCode} onChangeText={set('referenceCode')} placeholder="PRD-0012" maxLength={40} />
      <Field label={t('item_cost')} value={form.cost} onChangeText={digits('cost')} keyboardType="number-pad" prefix="$" />
      {kind === 'product' ? (
        <>
      <Field label={`${t('stock_quantity')} *`} value={form.stock} onChangeText={digits('stock')} error={errors.stock} keyboardType="number-pad" />

      <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
        {t('stock_status')}
      </AppText>
      <View role="radiogroup" aria-label={t('stock_status')}>
      {STOCK_STATUSES.map((option) => {
        const selected = status === option;
        const color = stockColor(option, colors);
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              setStatus(option);
              setStatusTouched(true);
            }}
            style={[styles.status, { borderColor: selected ? color : colors.border, backgroundColor: selected ? `${color}26` : colors.surface }]}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <AppText variant="bodyStrong" style={{ flex: 1 }}>
              {t(`status_${option}`)}
            </AppText>
            {suggested === option ? (
              <AppText variant="small" style={{ color, fontWeight: '800' }}>
                {t('suggested')}
              </AppText>
            ) : null}
            {selected ? <Ionicons name="checkmark" size={18} color={color} /> : null}
          </Pressable>
        );
      })}
      </View>
        </>
      ) : null}

      <View style={{ height: 14 }} />
      <Field label={t('item_notes')} value={form.notes} onChangeText={set('notes')} multiline maxLength={1000} />

      {general ? (
        <AppText tone="danger" style={{ marginBottom: 12 }} accessibilityLiveRegion="polite">
          {general}
        </AppText>
      ) : null}
      <Button label={id ? t('save_changes') : t('save')} onPress={submit} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumb: { width: 80, height: 80, borderRadius: radius.md, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
