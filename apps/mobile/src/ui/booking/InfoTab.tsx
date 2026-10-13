import { useQueryClient } from '@tanstack/react-query';
import { brandAccent, DEFAULT_ACCENT, PUBLIC_SECTIONS, type BookingAdminSettings, type PickedLocation, type PublicProfileInput } from '@xiro/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { pickFromLibrary, uploadableImage } from '@/lib/images';
import { keys } from '@/lib/queries';
import { useAuthed, useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useDialogs } from '../Dialogs';
import { Field } from '../Field';
import { Photo } from '../Kit';
import { Button, SectionTitle, ToggleRow } from './PanelKit';
import { AppText } from '../Text';
import { LocationPicker } from './LocationPicker';
import { useAction } from './useAction';

const MAX_GALLERY = 8;
const HEX = /^#[0-9a-f]{6}$/i;
/** Colores sugeridos para la marca (el negocio puede escribir cualquier otro): neutros, para cualquier tipo de negocio. */
const ACCENT_PRESETS = ['#c5a059', '#d4af37', '#1f4e79', '#2e7d5b', '#b4446c', '#6b4fa0', '#c2552d', '#2b2b2b'];
const isUrl = (value: string) => value === '' || /^https?:\/\/\S+$/i.test(value);

/** Cómo se presenta el negocio en su página: textos, redes, ubicación, secciones visibles, portada y galería. */
export function InfoTab({ data }: { data: BookingAdminSettings }) {
  const { t, theme } = useSettings();
  const { toast, confirm } = useDialogs();
  const queryClient = useQueryClient();
  const { business } = useAuthed();
  const { setBusiness } = useSession();
  const save = useAction();
  const media = useAction();
  const addressAction = useAction();
  const p = data.profile;
  const [form, setForm] = useState(() => toForm(p));
  const [sections, setSections] = useState(p.sections);
  const [location, setLocation] = useState(() => toLocation(p));
  const [address, setAddress] = useState(business.address);
  const [city, setCity] = useState(business.city);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm(toForm(p));
    setSections(p.sections);
    setLocation(toLocation(p));
  }, [data]);

  useEffect(() => {
    setAddress(business.address);
    setCity(business.city);
  }, [business.address, business.city]);

  /**
   * Dirección en texto plano, sin depender de Google ni de un pin: es la misma `businesses.address/city` que ya usa la
   * página pública como respaldo cuando no hay mapa configurado (ver `LocationCard`). Se guarda aparte del resto del
   * perfil porque vive en el negocio, no en `business_public_profiles`.
   */
  async function saveAddressText() {
    const saved = await addressAction.run(() => api.updateBusiness({ address: address.trim(), city: city.trim() }));
    if (!saved) return;
    setBusiness(saved);
    toast(t('saved'));
  }

  const set = (key: keyof typeof form) => (value: string) => setForm((c) => ({ ...c, [key]: value }));
  // Vista previa con los MISMOS tonos que verá la página (contraste garantizado), en el tema con que se mira el panel.
  const accentPreview = brandAccent(HEX.test(form.accentColor.trim()) ? form.accentColor.trim() : null)[theme === 'light' ? 'light' : 'dark'];
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.bookingSettings });

  async function submit() {
    const found: Record<string, string> = {};
    for (const key of ['instagram', 'facebook', 'tiktok', 'website'] as const) if (!isUrl(form[key].trim())) found[key] = t('bk_err_url');
    if (form.accentColor.trim() && !HEX.test(form.accentColor.trim())) found.accentColor = t('bk_accent_invalid');
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body: PublicProfileInput = {
      displayName: form.displayName.trim(),
      tagline: form.tagline.trim(),
      description: form.description.trim(),
      conditions: form.conditions.trim(),
      privacyPolicy: form.privacyPolicy.trim(),
      phone: form.phone.trim(),
      instagram: form.instagram.trim(),
      facebook: form.facebook.trim(),
      tiktok: form.tiktok.trim(),
      website: form.website.trim(),
      latitude: location?.lat ?? null,
      longitude: location?.lng ?? null,
      mapAddress: location?.address ?? '',
      placeId: location?.placeId ?? null,
      sections,
      // Marca (Fase 3): '' = dorado por defecto; los avisos vacíos no se guardan.
      accentColor: form.accentColor.trim() ? form.accentColor.trim().toLowerCase() : null,
      bookingTitle: form.bookingTitle.trim(),
      trustBadges: [form.badge1, form.badge2, form.badge3].map((b) => b.trim()).filter(Boolean),
    };
    const saved = await save.run(() => api.saveBookingProfile(body));
    if (!saved) return;
    await refresh();
    toast(t('saved'));
  }

  async function chooseCover() {
    const [picked] = await pickFromLibrary(1);
    if (!picked) return;
    const saved = await media.run(async () => api.uploadBookingCover(await uploadableImage(picked)));
    if (saved) {
      await refresh();
      toast(t('saved'));
    }
  }

  async function addGallery() {
    const [picked] = await pickFromLibrary(1);
    if (!picked) return;
    const saved = await media.run(async () => api.addGalleryPhoto(await uploadableImage(picked)));
    if (saved) await refresh();
  }

  async function removeGallery(file: string) {
    const ok = await confirm({ title: t('bk_photo_delete_title'), message: t('bk_photo_delete_text'), confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    const saved = await media.run(() => api.deleteGalleryPhoto(file));
    if (saved) await refresh();
  }

  return (
    <View>
      <SectionTitle>{t('bk_cover')}</SectionTitle>
      {/* Vista previa compacta de la portada (16:9, ancho máximo): no ocupa media pantalla. */}
      <Photo url={p.coverUrl} icon="image-outline" style={{ aspectRatio: 16 / 9, maxWidth: 480, borderRadius: 14 }} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Button label={p.coverUrl ? t('bk_cover_change') : t('bk_cover_add')} icon="image-outline" variant="secondary" compact loading={media.busy} onPress={() => void chooseCover()} />
        {p.coverUrl ? (
          <Button
            label={t('bk_cover_remove')}
            variant="ghost"
            compact
            disabled={media.busy}
            onPress={() =>
              void (async () => {
                if (await media.run(() => api.deleteBookingCover())) await refresh();
              })()
            }
          />
        ) : null}
      </View>
      {media.error ? (
        <AppText tone="danger" style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
          {media.error}
        </AppText>
      ) : null}

      <SectionTitle>{t('bk_gallery')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 8 }}>
        {t('bk_gallery_hint', { max: MAX_GALLERY })}
      </AppText>
      <View style={styles.gallery}>
        {p.gallery.map((photo) => (
          <View key={photo.file}>
            <Photo url={photo.url} size={82} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('delete')} onPress={() => void removeGallery(photo.file)} hitSlop={6} style={styles.remove}>
              <AppText style={{ color: '#fff', fontWeight: '800' }}>×</AppText>
            </Pressable>
          </View>
        ))}
      </View>
      <Button label={t('bk_gallery_add')} icon="add" variant="secondary" compact disabled={p.gallery.length >= MAX_GALLERY || media.busy} onPress={() => void addGallery()} style={{ alignSelf: 'flex-start', marginTop: 8 }} />

      <SectionTitle>{t('bk_info_title')}</SectionTitle>
      <Field label={t('bk_display_name')} value={form.displayName} onChangeText={set('displayName')} hint={t('bk_display_name_hint')} maxLength={80} error={save.fields.displayName} />
      <Field label={t('bk_tagline')} value={form.tagline} onChangeText={set('tagline')} maxLength={120} error={save.fields.tagline} />
      <Field label={t('bk_description')} value={form.description} onChangeText={set('description')} multiline maxLength={2000} error={save.fields.description} />
      <Field label={t('bk_conditions')} value={form.conditions} onChangeText={set('conditions')} hint={t('bk_conditions_hint')} multiline maxLength={1500} error={save.fields.conditions} />
      <Field label={t('bk_privacy')} value={form.privacyPolicy} onChangeText={set('privacyPolicy')} hint={t('bk_privacy_hint')} multiline maxLength={8000} error={save.fields.privacyPolicy} />

      <SectionTitle>{t('bk_brand_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 8 }}>
        {t('bk_brand_hint')}
      </AppText>
      <AppText variant="label" style={{ marginBottom: 6 }}>
        {t('bk_accent')}
      </AppText>
      <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel={t('bk_accent')}>
        {ACCENT_PRESETS.map((color) => {
          const selected = (form.accentColor.trim().toLowerCase() || DEFAULT_ACCENT) === color;
          return (
            <Pressable
              key={color}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={color === DEFAULT_ACCENT ? t('bk_accent_default') : color}
              onPress={() => setForm((c) => ({ ...c, accentColor: color === DEFAULT_ACCENT ? '' : color }))}
              style={[styles.swatch, { backgroundColor: color, borderColor: selected ? accentPreview.accentText : 'transparent' }]}
            />
          );
        })}
      </View>
      <Field label={t('bk_accent_custom')} value={form.accentColor} onChangeText={set('accentColor')} placeholder={DEFAULT_ACCENT} autoCapitalize="none" maxLength={7} error={errors.accentColor ?? save.fields.accentColor} />
      <View style={styles.previewRow} accessible accessibilityLabel={t('bk_brand_preview')}>
        <AppText variant="small" tone="muted">
          {t('bk_brand_preview')}
        </AppText>
        <View style={[styles.previewButton, { backgroundColor: accentPreview.accent }]}>
          <AppText variant="bodyStrong" style={{ color: accentPreview.onAccent }}>
            {t('pub_submit_cta')}
          </AppText>
        </View>
      </View>
      <Field label={t('bk_booking_title')} value={form.bookingTitle} onChangeText={set('bookingTitle')} hint={t('bk_booking_title_hint')} maxLength={60} error={save.fields.bookingTitle} />
      <AppText variant="label" style={{ marginBottom: 4 }}>
        {t('bk_trust_badges')}
      </AppText>
      <AppText variant="small" tone="muted" style={{ marginBottom: 6 }}>
        {t('bk_trust_badges_hint')}
      </AppText>
      {(['badge1', 'badge2', 'badge3'] as const).map((key, i) => (
        <Field key={key} label={String(i + 1)} value={form[key]} onChangeText={set(key)} maxLength={60} />
      ))}

      <SectionTitle>{t('bk_contact_title')}</SectionTitle>
      <Field label={t('bk_phone')} value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={30} />
      <Field label="Instagram" value={form.instagram} onChangeText={set('instagram')} placeholder="https://instagram.com/..." autoCapitalize="none" keyboardType="email-address" error={errors.instagram} />
      <Field label="Facebook" value={form.facebook} onChangeText={set('facebook')} placeholder="https://facebook.com/..." autoCapitalize="none" keyboardType="email-address" error={errors.facebook} />
      <Field label="TikTok" value={form.tiktok} onChangeText={set('tiktok')} placeholder="https://tiktok.com/@..." autoCapitalize="none" keyboardType="email-address" error={errors.tiktok} />
      <Field label={t('bk_website')} value={form.website} onChangeText={set('website')} placeholder="https://..." autoCapitalize="none" keyboardType="email-address" error={errors.website} />

      <SectionTitle>{t('bk_address_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 8 }}>
        {t('bk_address_hint')}
      </AppText>
      <Field label={t('address')} value={address} onChangeText={setAddress} maxLength={160} error={addressAction.fields.address} />
      <Field label={t('city')} value={city} onChangeText={setCity} maxLength={80} error={addressAction.fields.city} />
      {addressAction.error ? (
        <AppText tone="danger" style={{ marginBottom: 8 }} accessibilityLiveRegion="polite">
          {addressAction.error}
        </AppText>
      ) : null}
      <Button label={t('bk_address_save')} variant="secondary" compact loading={addressAction.busy} onPress={() => void saveAddressText()} style={{ alignSelf: 'flex-start' }} />

      <SectionTitle>{t('bk_map_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 8 }}>
        {t('bk_map_hint')}
      </AppText>
      <LocationPicker value={location} onChange={setLocation} />

      <SectionTitle>{t('bk_sections_title')}</SectionTitle>
      {PUBLIC_SECTIONS.map((section) => (
        <ToggleRow key={section} label={t(`bk_section_${section}`)} value={sections[section]} onChange={(v) => setSections((c) => ({ ...c, [section]: v }))} />
      ))}

      {save.error ? (
        <AppText tone="danger" style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
          {save.error}
        </AppText>
      ) : null}
      <Button label={t('save_changes')} loading={save.busy} onPress={() => void submit()} style={{ marginTop: 16 }} />
    </View>
  );
}

function toForm(p: BookingAdminSettings['profile']) {
  return {
    displayName: p.displayName,
    tagline: p.tagline,
    description: p.description,
    conditions: p.conditions,
    privacyPolicy: p.privacyPolicy,
    phone: p.phone,
    instagram: p.instagram,
    facebook: p.facebook,
    tiktok: p.tiktok,
    website: p.website,
    accentColor: p.accentColor ?? '',
    bookingTitle: p.bookingTitle,
    badge1: p.trustBadges[0] ?? '',
    badge2: p.trustBadges[1] ?? '',
    badge3: p.trustBadges[2] ?? '',
  };
}

function toLocation(p: BookingAdminSettings['profile']): PickedLocation | null {
  return p.latitude === null || p.longitude === null ? null : { lat: p.latitude, lng: p.longitude, address: p.mapAddress, placeId: p.placeId };
}

const styles = StyleSheet.create({
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  previewButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  remove: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: '#c53d3d', alignItems: 'center', justifyContent: 'center', borderColor: '#fff', borderWidth: 1 },
});
