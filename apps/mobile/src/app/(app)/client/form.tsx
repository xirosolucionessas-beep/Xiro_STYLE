import { clientInputSchema } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { apiErrors, issuesToErrors } from '@/lib/forms';
import { pickFromLibrary, uploadableImage } from '@/lib/images';
import { useBirthdayProgram, useClient, useInvalidateClients } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Photo } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function ClientForm() {
  const router = useRouter();
  const { t } = useSettings();
  const { toast, confirm } = useDialogs();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useClient(id).data;
  const invalidate = useInvalidateClients();
  const { user } = useAuthed();
  // Solo el dueño puede consultar el programa; para los demás se explica el uso de la fecha sin depender de él.
  const birthdayProgram = useBirthdayProgram(user.role === 'owner').data;
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', notes: '', birthDate: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const hydrated = useRef(false);

  useEffect(() => {
    if (!existing || hydrated.current) return;
    hydrated.current = true;
    setForm({ name: existing.name, email: existing.email ?? '', phone: existing.phone ?? '', address: existing.address, notes: existing.notes, birthDate: existing.birthDate ?? '' });
    setPhotoUrl(existing.photoUrl);
  }, [existing]);

  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function changePhoto() {
    if (!id) return;
    const [picked] = await pickFromLibrary(1);
    if (!picked) return;
    setPhotoBusy(true);
    setPhotoError(undefined);
    try {
      setPhotoUrl((await api.uploadClientPhoto(id, await uploadableImage(picked))).photoUrl);
      await invalidate();
    } catch (e) {
      setPhotoError(apiErrors(e, t).general ?? t('unknown_error'));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (!id) return;
    if (!(await confirm({ title: t('client_photo_remove_title'), message: t('client_photo_remove_text'), confirmLabel: t('delete'), destructive: true }))) return;
    setPhotoBusy(true);
    setPhotoError(undefined);
    try {
      setPhotoUrl((await api.deleteClientPhoto(id)).photoUrl);
      await invalidate();
    } catch (e) {
      setPhotoError(apiErrors(e, t).general ?? t('unknown_error'));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit() {
    setGeneral(undefined);
    const parsed = clientInputSchema.safeParse(form);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, t));
    setErrors({});
    setBusy(true);
    try {
      if (id) await api.updateClient(id, form);
      else await api.createClient(form);
      await invalidate();
      toast(id ? t('saved') : t('client_created'));
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
    <Screen header={<Header title={id ? t('client_edit') : t('client_new')} />}>
      {id ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <Photo url={photoUrl} size={72} initials={form.name} icon="person-outline" />
          <View style={{ flex: 1, gap: 6 }}>
            <AppText variant="small" tone="muted">
              {t('client_photo_hint')}
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button label={t(photoUrl ? 'account_photo_change' : 'account_photo_add')} icon="image-outline" variant="secondary" compact loading={photoBusy} onPress={() => void changePhoto()} style={{ alignSelf: 'flex-start' }} />
              {photoUrl ? <Button label={t('delete')} icon="trash-outline" variant="ghost" compact loading={photoBusy} onPress={() => void removePhoto()} style={{ alignSelf: 'flex-start' }} /> : null}
            </View>
            {photoError ? (
              <AppText tone="danger" variant="small">
                {photoError}
              </AppText>
            ) : null}
          </View>
        </View>
      ) : null}
      <Field label={`${t('full_name')} *`} value={form.name} onChangeText={set('name')} error={errors.name} maxLength={80} />
      <Field label={t('phone')} value={form.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" prefix="+57" />
      <Field label={t('email')} value={form.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" />
      <Field label={t('address')} value={form.address} onChangeText={set('address')} maxLength={160} />
      <Field label={t('client_notes')} value={form.notes} onChangeText={set('notes')} multiline maxLength={1000} />
      {/* Opcional: vacía = el cliente no participa en el programa de cumpleaños. Nunca bloquea guardar la ficha. */}
      <Field
        label={t('birth_date')}
        hint={t(birthdayProgram && !birthdayProgram.enabled ? 'birth_date_hint_off' : 'birth_date_hint_on')}
        placeholder={t('birth_date_placeholder')}
        value={form.birthDate}
        onChangeText={set('birthDate')}
        error={errors.birthDate}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        autoComplete="off"
      />
      {general ? (
        <AppText tone="danger" style={{ marginBottom: 12 }}>
          {general}
        </AppText>
      ) : null}
      <Button label={id ? t('save_changes') : t('save')} onPress={submit} loading={busy} />
    </Screen>
  );
}
