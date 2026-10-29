import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { Field } from './Field';
import { FormModal } from './FormModal';
import { AppText } from './Text';

export interface DeleteBusinessResult {
  ok: boolean;
  error?: string;
}

const COUNTDOWN_SECONDS = 5;

/**
 * Eliminación definitiva del negocio (zona de peligro, /profile — solo el dueño): explica qué se borra, pide la
 * contraseña ACTUAL (el servidor la vuelve a verificar) y obliga a esperar `COUNTDOWN_SECONDS` antes de dejar
 * confirmar. "Cancelar" siempre disponible salvo mientras la eliminación está en curso.
 */
export function DeleteBusinessModal({ visible, onClose, onSubmit }: { visible: boolean; onClose: () => void; onSubmit: (password: string) => Promise<DeleteBusinessResult> }) {
  const { t } = useSettings();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (!visible) return;
    setPassword('');
    setError(undefined);
    setBusy(false);
    setSecondsLeft(COUNTDOWN_SECONDS);
    const timer = setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  async function submit() {
    if (!password) return setError(t('required'));
    setBusy(true);
    setError(undefined);
    try {
      const result = await onSubmit(password);
      if (!result.ok) setError(result.error ?? t('unknown_error'));
    } finally {
      setBusy(false);
    }
  }

  const waiting = secondsLeft > 0;

  return (
    <FormModal
      title={t('delete_business_title')}
      onClose={onClose}
      footer={
        <View style={{ gap: 8 }}>
          <Button label={waiting ? t('delete_business_wait', { n: secondsLeft }) : t('delete_business_confirm_cta')} variant="danger" loading={busy} disabled={waiting || !password} onPress={submit} />
          <Button label={t('cancel')} variant="ghost" disabled={busy} onPress={onClose} />
        </View>
      }>
      <AppText style={{ marginBottom: 16 }}>{t('delete_business_body')}</AppText>
      <Field label={t('delete_business_password_label')} value={password} onChangeText={setPassword} password autoComplete="current-password" error={error} />
      {busy ? (
        <AppText variant="small" tone="muted" style={{ marginTop: 4 }}>
          {t('delete_business_processing')}
        </AppText>
      ) : null}
    </FormModal>
  );
}
