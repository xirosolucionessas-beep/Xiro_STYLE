import { useState } from 'react';
import { Linking, View } from 'react-native';
import { supportMailtoUrl } from '@/lib/contact';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { pickFromLibrary, uploadableImage } from '@/lib/images';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Photo } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function Profile() {
  const { t } = useSettings();
  const { user, business, setUser, signOut } = useSession();
  const { toast, confirm } = useDialogs();
  const [name, setName] = useState(user?.name ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>();

  async function changePhoto() {
    const [picked] = await pickFromLibrary(1);
    if (!picked) return;
    setPhotoBusy(true);
    setPhotoError(undefined);
    try {
      setUser(await api.uploadMyPhoto(await uploadableImage(picked)));
    } catch (e) {
      setPhotoError(apiErrors(e, t).general ?? t('unknown_error'));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    const ok = await confirm({ title: t('account_photo_remove_title'), message: t('account_photo_remove_text'), confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    setPhotoBusy(true);
    setPhotoError(undefined);
    try {
      setUser(await api.deleteMyPhoto());
    } catch (e) {
      setPhotoError(apiErrors(e, t).general ?? t('unknown_error'));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save() {
    if (!name.trim()) return setError(t('required'));
    setBusy(true);
    setError(undefined);
    try {
      setUser(await api.updateMe({ name: name.trim() }));
      toast(t('saved'));
    } catch (e) {
      const result = apiErrors(e, t);
      setError(result.general ?? Object.values(result.fields)[0]);
    } finally {
      setBusy(false);
    }
  }

  // Solicitud de eliminación (requisito de las tiendas): abre un correo a soporte ya redactado; la baja la procesa Xiro.
  const requestDeletion = async () => {
    if (!(await confirm({ title: t('delete_account_confirm_title'), message: t('delete_account_confirm_body'), confirmLabel: t('delete_account_request'), destructive: true }))) return;
    const account = user?.email ?? (user?.phone ? '+' + user.phone : '');
    const url = supportMailtoUrl(t('delete_account_mail_subject'), t('delete_account_mail_body', { account, business: business?.name ?? '' }));
    await Linking.openURL(url).catch(() => toast(t('unknown_error')));
  };

  const logout = async () => {
    if (await confirm({ title: t('logout'), message: t('logout_sub'), confirmLabel: t('logout'), destructive: true })) await signOut();
  };

  return (
    <Screen header={<Header title={t('profile')} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <Photo url={user?.photoUrl} size={72} icon="person-outline" />
        <View style={{ flex: 1, gap: 6 }}>
          <AppText variant="small" tone="muted">
            {t('account_photo_hint')}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button label={t(user?.photoUrl ? 'account_photo_change' : 'account_photo_add')} icon="image-outline" variant="secondary" compact loading={photoBusy} onPress={() => void changePhoto()} style={{ alignSelf: 'flex-start' }} />
            {user?.photoUrl ? <Button label={t('delete')} icon="trash-outline" variant="ghost" compact loading={photoBusy} onPress={() => void removePhoto()} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
          {photoError ? (
            <AppText tone="danger" variant="small">
              {photoError}
            </AppText>
          ) : null}
        </View>
      </View>
      <Field label={t('full_name')} value={name} onChangeText={setName} error={error} maxLength={80} />
      <View style={{ marginBottom: 14 }}>
        <AppText variant="label" tone="gold">
          {t('email')}
        </AppText>
        <AppText style={{ marginTop: 4 }}>{user?.email ?? '—'}</AppText>
      </View>
      <View style={{ marginBottom: 14 }}>
        <AppText variant="label" tone="gold">
          {t('phone')}
        </AppText>
        <AppText style={{ marginTop: 4 }}>{user?.phone ? `+${user.phone}` : '—'}</AppText>
      </View>
      <View style={{ marginBottom: 22 }}>
        <AppText variant="label" tone="gold">
          {t('business')}
        </AppText>
        <AppText style={{ marginTop: 4 }}>{business?.name}</AppText>
      </View>
      <Button label={t('save_changes')} onPress={save} loading={busy} />
      <Button label={t('logout')} variant="danger" icon="log-out-outline" onPress={logout} style={{ marginTop: 10 }} />
      <Button label={t('delete_account_request')} variant="ghost" icon="trash-outline" onPress={requestDeletion} style={{ marginTop: 6 }} />
    </Screen>
  );
}
