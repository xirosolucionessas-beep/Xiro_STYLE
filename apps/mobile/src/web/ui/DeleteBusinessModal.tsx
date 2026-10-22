import { useEffect, useState } from 'react';
import { Ico } from '../icons';
import { Button, Input, Modal } from '.';
import { useWebStyles } from './shared';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface DeleteBusinessResult {
  ok: boolean;
  error?: string;
}

export interface DeleteBusinessModalProps {
  open: boolean;
  onClose: () => void;
  t: T;
  onSubmit: (password: string) => Promise<DeleteBusinessResult>;
}

const COUNTDOWN_SECONDS = 5;

/**
 * Eliminación definitiva del negocio (zona de peligro, /profile — solo el dueño): explica qué se borra, pide la
 * contraseña ACTUAL (el servidor la vuelve a verificar — esto nunca es el único control) y obliga a esperar
 * `COUNTDOWN_SECONDS` antes de dejar confirmar, para que nadie la active por un clic accidental. "Cancelar" siempre
 * está disponible salvo mientras la eliminación está en curso (ahí se deshabilitan los dos botones: ni se repite la
 * petición ni se interrumpe a medias).
 */
export function DeleteBusinessModal({ open, onClose, t, onSubmit }: DeleteBusinessModalProps) {
  useWebStyles();
  // Montar/desmontar según `open` (en vez de un efecto que reinicie el estado "a mano" cada vez que se reabre) le da
  // al cuerpo sus valores iniciales de fábrica en cada apertura, sin la cascada de renders de poner estado en un efecto.
  if (!open) return null;
  return <DeleteBusinessModalBody onClose={onClose} t={t} onSubmit={onSubmit} />;
}

function DeleteBusinessModalBody({ onClose, t, onSubmit }: Omit<DeleteBusinessModalProps, 'open'>) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  async function submit() {
    if (!password) return setError(t('required'));
    setBusy(true);
    setError(undefined);
    try {
      const result = await onSubmit(password);
      if (!result.ok) setError(result.error ?? t('unknown_error'));
      // Si sale bien, quien llama cierra la sesión y navega — este modal no necesita hacer nada más.
    } finally {
      setBusy(false);
    }
  }

  const waiting = secondsLeft > 0;

  return (
    <Modal open onClose={onClose} title={t('delete_business_title')} closeLabel={t('close')} dismissOnBackdrop={!busy}>
      <span className="xw-cash-ic" aria-hidden="true">
        <Ico name="triangle-alert" size={26} />
      </span>
      <p className="xw-cash-q">{t('delete_business_body')}</p>
      <Input
        label={t('delete_business_password_label')}
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="current-password"
        name="currentPassword"
        error={error}
        showPasswordLabel={t('show_password')}
        hidePasswordLabel={t('hide_password')}
      />
      <div className="xw-wactions" style={{ marginTop: 8 }}>
        <Button fullWidth variant="danger" loading={busy} loadingLabel={busy ? t('delete_business_processing') : t('loading')} disabled={waiting || !password} onPress={() => void submit()}>
          {waiting ? t('delete_business_wait', { n: secondsLeft }) : t('delete_business_confirm_cta')}
        </Button>
        <Button variant="ghost" fullWidth onPress={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
      </div>
    </Modal>
  );
}
