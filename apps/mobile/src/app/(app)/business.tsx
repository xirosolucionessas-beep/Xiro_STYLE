import { Ionicons } from '@expo/vector-icons';
import { BUSINESS_TYPES, businessUpdateSchema, CURRENCIES, type BusinessHours, type BusinessType, type Currency } from '@xiro/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { apiErrors, issuesToErrors } from '@/lib/forms';
import { pickFromLibrary, uploadableImage } from '@/lib/images';
import { useAuthed, useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Brand } from '@/ui/Brand';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Chip, ChipRow, SectionTitle, Toggle } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

const formatTime = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
};

export default function BusinessScreen() {
  const { t, colors } = useSettings();
  const { business } = useAuthed();
  const { setBusiness } = useSession();
  const { toast } = useDialogs();
  const [name, setName] = useState(business.name);
  const [type, setType] = useState<BusinessType>(business.type);
  const [whatsapp, setWhatsapp] = useState(business.whatsapp ?? '');
  const [address, setAddress] = useState(business.address);
  const [city, setCity] = useState(business.city);
  const [country, setCountry] = useState(business.country);
  const [taxId, setTaxId] = useState(business.taxId);
  const [currency, setCurrency] = useState<Currency>(business.currency);
  const [hours, setHours] = useState<BusinessHours>(business.hours);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  const setSame = (same: boolean) => {
    if (!same) return setHours({ ...hours, sameEveryDay: false });
    const source = hours.days.find((d) => d.open) ?? hours.days[1]!;
    setHours({ sameEveryDay: true, days: hours.days.map((d) => ({ ...d, open: true, from: source.from, to: source.to })) });
  };
  const setDay = (day: number, patch: Partial<BusinessHours['days'][number]>) =>
    setHours((current) => ({
      ...current,
      days: current.days.map((d) => (current.sameEveryDay || d.day === day ? { ...d, ...patch } : d)),
    }));

  async function changeLogo() {
    setLogoBusy(true);
    try {
      const [picked] = await pickFromLibrary(1);
      if (picked) setBusiness(await api.uploadLogo(await uploadableImage(picked, 'logo')));
    } catch (error) {
      setGeneral(apiErrors(error, t).general);
    } finally {
      setLogoBusy(false);
    }
  }

  async function save() {
    setGeneral(undefined);
    const body = { name, type, whatsapp, address, city, country, taxId, currency, hours };
    const parsed = businessUpdateSchema.safeParse(body);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, t));
    setErrors({});
    setBusy(true);
    try {
      setBusiness(await api.updateBusiness(body));
      toast(t('saved'));
    } catch (error) {
      const result = apiErrors(error, t);
      setErrors(result.fields);
      setGeneral(result.general);
    } finally {
      setBusy(false);
    }
  }

  const firstDay = hours.days[1] ?? hours.days[0]!;

  return (
    <Screen header={<Header title={t('business_settings')} />}>
      <View style={styles.logoRow}>
        <Brand size={72} logoUrl={business.logoUrl} />
        <Button label={t('logo_change')} icon="camera-outline" variant="secondary" compact loading={logoBusy} onPress={changeLogo} />
      </View>

      <Field label={t('business_name')} value={name} onChangeText={setName} error={errors.name} maxLength={80} />
      <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
        {t('business_type')}
      </AppText>
      <View style={{ marginBottom: 14 }}>
        <ChipRow label={t('business_type')}>
          {BUSINESS_TYPES.map((option) => (
            <Chip key={option} label={t(`type_${option}`)} selected={type === option} onPress={() => setType(option)} />
          ))}
        </ChipRow>
      </View>
      <Field label={t('business_whatsapp')} value={whatsapp} onChangeText={setWhatsapp} error={errors.whatsapp} keyboardType="phone-pad" prefix="+57" />
      <Field label={t('address')} value={address} onChangeText={setAddress} maxLength={160} />
      <Field label={t('city')} value={city} onChangeText={setCity} maxLength={80} />
      <Field label={t('country')} value={country} onChangeText={setCountry} maxLength={80} />
      <Field label={t('business_tax_id')} value={taxId} onChangeText={setTaxId} error={errors.taxId} maxLength={40} hint={t('business_tax_id_hint')} />

      <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
        {t('currency')}
      </AppText>
      <ChipRow label={t('currency')}>
        {CURRENCIES.map((option) => (
          <Chip key={option} label={option} selected={currency === option} onPress={() => setCurrency(option)} />
        ))}
      </ChipRow>

      <SectionTitle>{t('hours')}</SectionTitle>
      <View style={styles.switchRow}>
        <AppText style={{ flex: 1 }}>{t('same_hours')}</AppText>
        <Toggle value={hours.sameEveryDay} onChange={setSame} label={t('same_hours')} />
      </View>

      {hours.sameEveryDay ? (
        <View style={styles.timeRow}>
          <View style={{ flex: 1 }}>
            <Field label={t('from')} value={firstDay.from} onChangeText={(v) => setDay(firstDay.day, { from: formatTime(v) })} keyboardType="number-pad" maxLength={5} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('to')} value={firstDay.to} onChangeText={(v) => setDay(firstDay.day, { to: formatTime(v) })} keyboardType="number-pad" maxLength={5} />
          </View>
        </View>
      ) : (
        hours.days.map((day) => (
          <View key={day.day} style={styles.dayRow}>
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: day.open }} onPress={() => setDay(day.day, { open: !day.open })} style={styles.dayToggle}>
              <Ionicons name={day.open ? 'checkbox' : 'square-outline'} size={22} color={colors.gold} />
              <AppText variant="bodyStrong" style={{ width: 92 }}>
                {t(`day_${day.day}`)}
              </AppText>
            </Pressable>
            {day.open ? (
              <View style={styles.timeRow}>
                <View style={{ flex: 1 }}>
                  <Field label={t('from')} value={day.from} onChangeText={(v) => setDay(day.day, { from: formatTime(v) })} keyboardType="number-pad" maxLength={5} />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label={t('to')} value={day.to} onChangeText={(v) => setDay(day.day, { to: formatTime(v) })} keyboardType="number-pad" maxLength={5} />
                </View>
              </View>
            ) : (
              <AppText tone="muted" variant="small">
                {t('closed')}
              </AppText>
            )}
          </View>
        ))
      )}
      {errors.hours ? (
        <AppText variant="small" tone="danger">
          {errors.hours}
        </AppText>
      ) : null}

      {general ? (
        <AppText tone="danger" style={{ marginVertical: 12 }}>
          {general}
        </AppText>
      ) : null}
      <Button label={t('save_changes')} onPress={save} loading={busy} style={{ marginTop: 18 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  timeRow: { flexDirection: 'row', gap: 12 },
  dayRow: { marginBottom: 6 },
  dayToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
});
