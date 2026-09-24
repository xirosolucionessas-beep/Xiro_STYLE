import { Ionicons } from '@expo/vector-icons';
import { BUSINESS_TYPES, defaultBusinessHours, type BusinessType } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { api, setAccessToken } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { pickFromLibrary, uploadableImage, type PickedImage } from '@/lib/images';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { AuthShell } from '@/ui/AuthShell';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Chip, ChipRow } from '@/ui/Kit';
import { SocialButtons } from '@/ui/SocialButtons';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';
import { COUNTRIES, countryByCode, DEFAULT_COUNTRY, type CountryCode } from '@/lib/countries';
import { buildBusinessUpdate, buildRegisterPayload, runRegistration, validateStep1, validateStep2 } from '@/lib/registration';

/**
 * Registro nativo con la MISMA lógica y endpoints que la Web (src/web/registration.ts):
 * POST /api/auth/register → PATCH /api/business (dirección, ciudad, país y moneda) → PUT /api/business/logo (opcional).
 * Si un paso posterior falla la cuenta ya existe: se entra igual y se avisa que puede completarse en Ajustes.
 * El método de pago no se pide aquí: en Android/iOS la suscripción se gestiona en la tienda (RevenueCat), en Ajustes → Plan.
 */
export default function Register() {
  const router = useRouter();
  const { t, language, colors } = useSettings();
  const { signIn } = useSession();
  const { toast } = useDialogs();
  const [form, setForm] = useState({ name: '', businessName: '', email: '', phone: '', password: '', confirm: '', address: '', city: '' });
  const [businessType, setBusinessType] = useState<BusinessType>('barbershop');
  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [logo, setLogo] = useState<PickedImage | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _cleared, ...rest }) => rest);
  };
  const dial = countryByCode(country).dial;

  async function chooseLogo() {
    try {
      const [picked] = await pickFromLibrary(1);
      if (picked) setLogo(picked);
    } catch {
      setGeneral(t('unknown_error'));
    }
  }

  async function submit() {
    setGeneral(undefined);
    const step1 = { name: form.name, businessName: form.businessName, businessType, email: form.email, phone: form.phone, password: form.password, confirm: form.confirm, accepted, language };
    const step2 = { address: form.address, city: form.city, country, hours: defaultBusinessHours() };
    const keys = { ...validateStep2(step2), ...validateStep1(step1, dial) };
    if (Object.keys(keys).length > 0) return setErrors(Object.fromEntries(Object.entries(keys).map(([field, key]) => [field, t(key)])));

    setErrors({});
    setBusy(true);
    try {
      const outcome = await runRegistration(
        { payload: buildRegisterPayload(step1, dial), business: buildBusinessUpdate(step2), photo: logo },
        {
          register: api.register,
          authorize: setAccessToken,
          updateBusiness: api.updateBusiness,
          uploadLogo: async (photo) => api.uploadLogo(await uploadableImage(photo, 'logo')),
          signIn,
        },
      );
      if (outcome.status === 'failed') {
        const result = apiErrors(outcome.error, t);
        setErrors(result.fields);
        setGeneral(result.general);
      } else if (outcome.status === 'partial') {
        // La cuenta ya existe: se entra con lo guardado (no se registra dos veces) y se avisa qué falta.
        toast(t('reg_partial_notice'));
        await signIn(outcome.progress.session);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('create_account_title')} subtitle={t('create_account_sub')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}>
      <SocialButtons intent="signup" />

      <Field label={t('full_name')} value={form.name} onChangeText={set('name')} error={errors.name} autoComplete="name" textContentType="name" />
      <Field label={t('business_name')} value={form.businessName} onChangeText={set('businessName')} error={errors.businessName} />

      <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
        {t('business_type')}
      </AppText>
      <View style={{ marginBottom: 14 }}>
        <ChipRow label={t('business_type')}>
          {BUSINESS_TYPES.map((type) => (
            <Chip key={type} label={t(`type_${type}`)} selected={businessType === type} onPress={() => setBusinessType(type)} />
          ))}
        </ChipRow>
      </View>

      <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
        {t('reg_country_label')}
      </AppText>
      <View style={{ marginBottom: 14 }}>
        <ChipRow label={t('reg_country_label')}>
          {COUNTRIES.map((c) => (
            <Chip key={c.code} label={`${c.name} +${c.dial}`} selected={country === c.code} onPress={() => setCountry(c.code)} />
          ))}
        </ChipRow>
      </View>

      <Field label={t('email')} value={form.email} onChangeText={set('email')} error={errors.email} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <Field label={t('phone')} value={form.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" prefix={`+${dial}`} />
      <Field label={t('address')} value={form.address} onChangeText={set('address')} error={errors.address} maxLength={160} autoComplete="street-address" textContentType="fullStreetAddress" />
      <Field label={t('city')} value={form.city} onChangeText={set('city')} error={errors.city} maxLength={80} textContentType="addressCity" />

      <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
        {t('reg_logo_label')}
      </AppText>
      <View style={styles.logoRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('add_photo')} onPress={() => void chooseLogo()} style={[styles.logoBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {logo ? <Image source={{ uri: logo.uri }} style={styles.logoImage} accessibilityIgnoresInvertColors /> : <Ionicons name="camera-outline" size={28} color={colors.gold} />}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Button label={t('gallery')} variant="secondary" compact onPress={() => void chooseLogo()} />
          {logo ? <Button label={t('reg_logo_remove')} variant="ghost" compact onPress={() => setLogo(null)} /> : null}
        </View>
      </View>

      <Field label={t('password')} value={form.password} onChangeText={set('password')} error={errors.password} hint={t('password_hint')} password textContentType="newPassword" autoComplete="new-password" />
      <Field label={t('confirm_password')} value={form.confirm} onChangeText={set('confirm')} error={errors.confirm} password textContentType="newPassword" />

      <View style={styles.terms}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          accessibilityLabel={t('accept_terms')}
          onPress={() => setAccepted((v) => !v)}
          style={[styles.box, { borderColor: errors.acceptTerms ? colors.danger : colors.gold, backgroundColor: accepted ? colors.gold : 'transparent' }]}>
          {accepted ? <Ionicons name="checkmark" size={16} color={colors.onGold} /> : null}
        </Pressable>
        <Pressable onPress={() => router.push('/terms')} style={{ flex: 1 }}>
          <AppText>{t('accept_terms')}</AppText>
        </Pressable>
      </View>
      {errors.acceptTerms ? (
        <AppText variant="small" tone="danger" style={{ marginBottom: 10 }}>
          {errors.acceptTerms}
        </AppText>
      ) : null}
      {general ? (
        <AppText tone="danger" style={{ marginBottom: 12 }} accessibilityLiveRegion="polite">
          {general}
        </AppText>
      ) : null}

      <Button label={t('create_account')} onPress={submit} loading={busy} />
      <Button label={`${t('have_account')} ${t('login')}`} variant="ghost" onPress={() => router.replace('/login')} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  terms: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  logoBox: { width: 84, height: 84, borderRadius: radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImage: { width: '100%', height: '100%' },
});
