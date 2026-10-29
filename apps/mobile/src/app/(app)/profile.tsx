import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { supportMailtoUrl } from '@/lib/contact';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { pickFromLibrary, uploadableImage } from '@/lib/images';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { DeleteBusinessModal } from '@/ui/DeleteBusinessModal';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Card, Photo, SectionTitle } from '@/ui/Kit';
import { Header, Screen } from '@/ui/Screen';
import { SubscriptionStatusCard } from '@/ui/SubscriptionStatusCard';
import { AppText } from '@/ui/Text';

export default function Profile() {
  const { t, colors } = useSettings();
  const { user, business, setUser, signOut } = useSession();
  const { toast, confirm } = useDialogs();
  const [name, setName] = useState(user?.name ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string>();
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  async function changePassword() {
    if (newPassword !== confirmPassword) return setPasswordError(t('change_password_mismatch'));
    setPasswordError(undefined);
    setPasswordBusy(true);
    try {
      await api.changeMyPassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast(t('change_password_success'));
    } catch (e) {
      // apiErrors() separa errores de validación (p. ej. contraseña nueva débil) en `fields`, sin `general`: antes
      // esa rama caía siempre en "Ocurrió un error inesperado" sin decir qué campo estaba mal.
      const result = apiErrors(e, t);
      setPasswordError(result.fields.newPassword ?? result.fields.currentPassword ?? result.general ?? t('unknown_error'));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function deleteBusiness(password: string) {
    try {
      await api.deleteBusiness(password);
      toast(t('delete_business_success'));
      await signOut();
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: apiErrors(e, t).general ?? t('unknown_error') };
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
      <SubscriptionStatusCard />
      <Card style={{ marginBottom: 16 }}>
        <SectionTitle>{t('profile_section_title')}</SectionTitle>
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
        <View style={{ marginBottom: 18 }}>
          <AppText variant="label" tone="gold">
            {t('business')}
          </AppText>
          <AppText style={{ marginTop: 4 }}>{business?.name}</AppText>
        </View>
        <Button label={t('save_changes')} onPress={save} loading={busy} />
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <SectionTitle>{t('profile_security_title')}</SectionTitle>
        <AppText variant="small" tone="muted" style={{ marginTop: -6, marginBottom: 14 }}>
          {t('profile_security_sub')}
        </AppText>
        <Field label={t('change_password_current')} value={currentPassword} onChangeText={setCurrentPassword} password autoComplete="current-password" />
        <Field label={t('change_password_new')} value={newPassword} onChangeText={setNewPassword} password autoComplete="new-password" hint={t('password_weak')} />
        <Field label={t('change_password_confirm')} value={confirmPassword} onChangeText={setConfirmPassword} password autoComplete="new-password" error={passwordError} />
        <Button label={t('change_password_cta')} onPress={() => void changePassword()} loading={passwordBusy} disabled={!currentPassword || !newPassword || !confirmPassword} />
      </Card>

      {user?.role === 'owner' ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: advancedOpen }}
            accessibilityLabel={t('advanced_business_options')}
            onPress={() => setAdvancedOpen((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
            <Ionicons name={advancedOpen ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.textMuted} />
            <AppText variant="bodyStrong">{t('advanced_business_options')}</AppText>
          </Pressable>
          {advancedOpen ? (
            <View style={{ marginTop: 10 }}>
              <AppText variant="title" tone="danger" style={{ marginBottom: 10 }}>
                {t('danger_zone_title')}
              </AppText>
              <Button label={t('delete_business_cta')} variant="danger" icon="warning-outline" onPress={() => setDeleteOpen(true)} style={{ marginTop: 16 }} />
            </View>
          ) : null}
          <DeleteBusinessModal visible={deleteOpen} onClose={() => setDeleteOpen(false)} onSubmit={deleteBusiness} />
        </>
      ) : null}

      <Button label={t('logout')} variant="danger" icon="log-out-outline" onPress={logout} style={{ marginTop: 28 }} />
      <Button label={t('delete_account_request')} variant="ghost" icon="trash-outline" onPress={requestDeletion} style={{ marginTop: 6 }} />
    </Screen>
  );
}
