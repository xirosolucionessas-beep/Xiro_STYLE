/**
 * Ruta /profile SOLO WEB (nativo: profile.tsx, sin cambios). A diferencia del nativo, el celular SÍ se puede editar
 * aquí: se verifica con un código de un solo uso antes de aplicarse (POST /api/me/phone/request + /confirm).
 * Presentación en src/web/screens/Profile.tsx.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { api } from '@/lib/api';
import { useSubscription } from '@/lib/queries';
import { apiErrors } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { Header, Screen } from '@/ui/Screen';
import { ProfileView } from '@/web/screens/Profile';
import { photoToFormData } from '@/web/services/imageUpload.web';
import { useWebText } from '@/web/services/useWebText';
import { validatePhotoFile } from '@/web/ui/PhotoPicker';
import { SubscriptionStatusView } from '@/web/ui/SubscriptionStatusView';

export default function ProfileWeb() {
  const { t, language } = useWebText();
  const { user, business, setUser, signOut } = useSession();
  const router = useRouter();
  const subscription = useSubscription();
  const { refetch } = subscription;
  // Al volver al perfil (p. ej. desde la notificación de acceso ampliado) se vuelve a consultar: refleja el cambio real.
  useFocusEffect(useCallback(() => void refetch(), [refetch]));
  if (!user || !business) return null;

  async function changePhoto(file: File) {
    const problem = validatePhotoFile(file);
    if (problem) return { ok: false as const, error: t(problem) };
    const uri = URL.createObjectURL(file);
    try {
      setUser(await api.uploadMyPhoto(await photoToFormData({ uri }, 'photo')));
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: apiErrors(error, t).general ?? t('unknown_error') };
    } finally {
      URL.revokeObjectURL(uri);
    }
  }

  async function removePhoto() {
    try {
      setUser(await api.deleteMyPhoto());
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: apiErrors(error, t).general ?? t('unknown_error') };
    }
  }

  async function saveName(name: string) {
    try {
      setUser(await api.updateMe({ name }));
      return { ok: true as const };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false as const, error: result.fields.name ?? result.general ?? t('unknown_error') };
    }
  }

  async function requestPhoneChange(phone: string) {
    try {
      await api.requestPhoneChange(phone);
      return { ok: true as const };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false as const, error: result.fields.phone ?? result.general ?? t('unknown_error') };
    }
  }

  async function confirmPhoneChange(code: string) {
    try {
      setUser(await api.confirmPhoneChange(code));
      return { ok: true as const };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false as const, error: result.fields.code ?? result.general ?? t('unknown_error') };
    }
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    try {
      await api.changeMyPassword({ currentPassword, newPassword });
      return { ok: true as const };
    } catch (error) {
      // apiErrors() separa errores de validación (p. ej. contraseña nueva débil) en `fields`, sin `general`: antes
      // esa rama caía siempre en "Ocurrió un error inesperado" sin decir qué campo estaba mal.
      const result = apiErrors(error, t);
      return { ok: false as const, error: result.fields.newPassword ?? result.fields.currentPassword ?? result.general ?? t('unknown_error') };
    }
  }

  async function deleteBusiness(password: string) {
    try {
      await api.deleteBusiness(password);
      await signOut();
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: apiErrors(error, t).general ?? t('unknown_error') };
    }
  }

  return (
    <Screen header={<Header title={t('profile')} subtitle={user.email ?? undefined} />}>
    <SubscriptionStatusView
      t={t}
      language={language}
      timezone={business.timezone}
      isOwner={user.role !== 'employee'}
      state={subscription.data ? { kind: 'ready', subscription: subscription.data } : subscription.error ? { kind: 'error', retrying: subscription.isFetching } : { kind: 'loading' }}
      onRetry={() => void subscription.refetch()}
      onManage={() => router.push('/subscription')}
    />
    <ProfileView
      t={t}
      user={user}
      businessName={business.name}
      isOwner={user.role === 'owner'}
      onSaveName={saveName}
      onChangePhoto={changePhoto}
      onRemovePhoto={removePhoto}
      onRequestPhoneChange={requestPhoneChange}
      onConfirmPhoneChange={confirmPhoneChange}
      onChangePassword={changePassword}
      onDeleteBusiness={deleteBusiness}
      onLogout={() => {
        if (window.confirm(t('logout_sub'))) void signOut();
      }}
    />
    </Screen>
  );
}
