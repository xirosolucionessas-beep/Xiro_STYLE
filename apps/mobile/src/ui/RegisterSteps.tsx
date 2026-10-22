import { Ionicons } from '@expo/vector-icons';
import { BUSINESS_TYPES } from '@xiro/shared';
import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { COUNTRIES, countryByCode, flagEmoji, phoneDigits } from '@/lib/countries';
import type { PickedImage } from '@/lib/images';
import type { RegistrationDraft } from '@/lib/registrationDraft';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { Field } from './Field';
import { HoursEditor } from './HoursEditor';
import { Chip, ChipRow } from './Kit';
import { OrDivider } from './OrDivider';
import { SocialButtons } from './SocialButtons';
import { AppText } from './Text';
import { radius } from './theme';

export interface Secrets {
  password: string;
  confirm: string;
}

type Errors = Record<string, string>;
type Change = (patch: Partial<RegistrationDraft>) => void;

function Label({ children }: { children: ReactNode }) {
  return (
    <AppText variant="label" tone="muted" style={{ marginBottom: 6 }}>
      {children}
    </AppText>
  );
}

function CountryChips({ value, onChange }: { value: RegistrationDraft['country']; onChange: Change }) {
  const { t } = useSettings();
  return (
    <>
      <Label>{t('reg_country_label')}</Label>
      <View style={{ marginBottom: 14 }}>
        <ChipRow label={t('reg_country_label')}>
          {COUNTRIES.map((country) => (
            <Chip key={country.code} label={`${flagEmoji(country.code)} ${country.name} +${country.dial}`} selected={value === country.code} onPress={() => onChange({ country: country.code })} />
          ))}
        </ChipRow>
      </View>
    </>
  );
}

/** Paso 1: cuenta. Mismos campos y validaciones que la Web (validateStep1 en src/lib/registration.ts). */
export function StepAccount({ draft, secrets, errors, onChange, onSecrets, onOpenTerms, onNext }: { draft: RegistrationDraft; secrets: Secrets; errors: Errors; onChange: Change; onSecrets: (patch: Partial<Secrets>) => void; onOpenTerms: () => void; onNext: () => void }) {
  const { t, colors } = useSettings();
  const dial = countryByCode(draft.country).dial;
  return (
    <>
      <SocialButtons intent="signup" />
      <OrDivider label={t('or_with_email')} />

      <Field label={t('full_name')} value={draft.name} onChangeText={(name) => onChange({ name })} error={errors.name} autoComplete="name" textContentType="name" maxLength={80} />
      <Field label={t('business_name')} value={draft.businessName} onChangeText={(businessName) => onChange({ businessName })} error={errors.businessName} maxLength={80} />

      <Label>{t('business_type')}</Label>
      <View style={{ marginBottom: 14 }}>
        {/* Solo Barbería es seleccionable en el registro por ahora; el resto de BUSINESS_TYPES sigue intacto
           (negocios existentes, catálogo, settings, etc.) — se ocultan únicamente estos botones. */}
        <ChipRow label={t('business_type')}>
          {BUSINESS_TYPES.filter((type) => type === 'barbershop').map((type) => (
            <Chip key={type} label={t(`type_${type}`)} selected={draft.businessType === type} onPress={() => onChange({ businessType: type })} />
          ))}
        </ChipRow>
      </View>

      <CountryChips value={draft.country} onChange={onChange} />

      <Field label={t('email')} value={draft.email} onChangeText={(email) => onChange({ email })} error={errors.email} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <Field label={t('phone')} value={draft.phone} onChangeText={(phone) => onChange({ phone: phoneDigits(phone) })} error={errors.phone} keyboardType="number-pad" autoComplete="tel" textContentType="telephoneNumber" prefix={`+${dial}`} />
      <Field label={t('password')} value={secrets.password} onChangeText={(password) => onSecrets({ password })} error={errors.password} hint={t('password_hint')} password textContentType="newPassword" autoComplete="new-password" />
      <Field label={t('confirm_password')} value={secrets.confirm} onChangeText={(confirm) => onSecrets({ confirm })} error={errors.confirm} password textContentType="newPassword" />

      <View style={styles.terms}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: draft.accepted }}
          accessibilityLabel={t('accept_terms')}
          onPress={() => onChange({ accepted: !draft.accepted })}
          hitSlop={12}
          style={[styles.box, { borderColor: errors.acceptTerms ? colors.danger : draft.accepted ? colors.gold : colors.border, backgroundColor: draft.accepted ? colors.gold : 'transparent' }]}>
          {draft.accepted ? <Ionicons name="checkmark" size={16} color={colors.onGold} /> : null}
        </Pressable>
        <Pressable accessibilityRole="link" onPress={onOpenTerms} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
          <AppText>{t('accept_terms')}</AppText>
        </Pressable>
      </View>
      {errors.acceptTerms ? (
        <AppText variant="small" tone="danger" style={{ marginBottom: 10 }}>
          {errors.acceptTerms}
        </AppText>
      ) : null}

      <Button label={t('continue')} onPress={onNext} />
    </>
  );
}

/** Paso 2: negocio (dirección, ciudad, país y horario). Dirección y ciudad son obligatorias, como en la Web. */
export function StepBusiness({ draft, errors, onChange, onNext, onBack }: { draft: RegistrationDraft; errors: Errors; onChange: Change; onNext: () => void; onBack: () => void }) {
  const { t } = useSettings();
  const country = countryByCode(draft.country);
  return (
    <>
      <Field label={t('address')} value={draft.address} onChangeText={(address) => onChange({ address })} error={errors.address} maxLength={160} autoComplete="street-address" textContentType="fullStreetAddress" />
      <Field label={t('city')} value={draft.city} onChangeText={(city) => onChange({ city })} error={errors.city} maxLength={80} textContentType="addressCity" />

      <CountryChips value={draft.country} onChange={onChange} />
      <AppText tone="muted" variant="small" style={{ marginTop: -6, marginBottom: country.currencyIsFallback ? 4 : 16 }}>
        {t('reg_prefix_currency', { dial: country.dial, currency: country.currency })}
      </AppText>
      {country.currencyIsFallback ? (
        <AppText tone="muted" variant="small" style={{ marginBottom: 16 }}>
          {t('reg_currency_fallback')}
        </AppText>
      ) : null}

      <Label>{t('reg_hours_title')}</Label>
      <HoursEditor hours={draft.hours} onChange={(hours) => onChange({ hours })} />
      {errors.hours ? (
        <AppText tone="danger" variant="small" accessibilityLiveRegion="polite" style={{ marginBottom: 10 }}>
          {errors.hours}
        </AppText>
      ) : null}

      <View style={{ height: 12 }} />
      <Button label={t('continue')} onPress={onNext} />
      <Button label={t('back')} variant="ghost" onPress={onBack} />
    </>
  );
}

/** Paso 3: foto opcional del negocio (galería o cámara), con los permisos pedidos solo al usarlos. */
export function StepPhoto({ logo, notice, busy, onGallery, onCamera, onRemove, onFinish, onSkip, onBack }: { logo: PickedImage | null; notice?: string; busy: boolean; onGallery: () => void; onCamera: () => void; onRemove: () => void; onFinish: () => void; onSkip: () => void; onBack: () => void }) {
  const { t, colors } = useSettings();
  return (
    <>
      <View style={[styles.photoBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        {logo ? (
          <Image source={{ uri: logo.uri }} style={styles.photo} accessibilityLabel={t('reg_photo_title')} accessibilityIgnoresInvertColors />
        ) : (
          <View style={styles.photoEmpty}>
            <Ionicons name="camera-outline" size={34} color={colors.textMuted} />
            <AppText variant="bodyStrong" center>
              {t('reg_photo_title')}
            </AppText>
            <AppText tone="muted" variant="small">
              {t('reg_photo_optional')}
            </AppText>
            <AppText tone="muted" variant="small" center>
              {t('reg_photo_hint')}
            </AppText>
          </View>
        )}
      </View>

      <View style={styles.photoActions}>
        <View style={{ flex: 1 }}>
          <Button label={t('reg_photo_upload')} variant="secondary" icon="images-outline" onPress={onGallery} disabled={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t('reg_photo_take')} variant="secondary" icon="camera-outline" onPress={onCamera} disabled={busy} />
        </View>
      </View>
      {logo ? <Button label={t('reg_logo_remove')} variant="ghost" compact onPress={onRemove} disabled={busy} /> : null}
      {notice ? (
        <AppText tone="danger" variant="small" accessibilityLiveRegion="polite" style={{ marginVertical: 8 }}>
          {notice}
        </AppText>
      ) : null}

      <View style={{ height: 8 }} />
      <Button label={t('reg_finish')} onPress={onFinish} loading={busy} />
      <Button label={t('reg_skip')} variant="ghost" onPress={onSkip} disabled={busy} />
      <Button label={t('back')} variant="ghost" onPress={onBack} disabled={busy} />
    </>
  );
}

const styles = StyleSheet.create({
  terms: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  photoBox: { minHeight: 220, borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden', marginBottom: 14 },
  photoEmpty: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20 },
  photo: { width: '100%', height: 260 },
  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 4 },
});
