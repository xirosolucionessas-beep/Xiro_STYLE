import { useState } from 'react';
import { Ico } from '../icons';
import { Button, Input, Modal } from '.';
import { useWebStyles } from './shared';

type T = (key: string) => string;

export interface VoidCashClosingResult {
  ok: boolean;
  general?: string;
}

export interface VoidCashClosingModalProps {
  open: boolean;
  onClose: () => void;
  t: T;
  onSubmit: (reason: string) => Promise<VoidCashClosingResult>;
}

/** Anular un cierre de caja pide SIEMPRE un motivo (no se edita, no se borra: queda marcado "Anulado" en la bitácora). */
export function VoidCashClosingModal({ open, onClose, t, onSubmit }: VoidCashClosingModalProps) {
  useWebStyles();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit() {
    const trimmed = reason.trim();
    if (!trimmed) return setError(t('cash_close_void_reason_required'));
    setBusy(true);
    setError(undefined);
    try {
      const result = await onSubmit(trimmed);
      if (result.ok) setReason('');
      else setError(result.general ?? t('unknown_error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('cash_close_void_title')} closeLabel={t('close')} dismissOnBackdrop={!busy}>
      <span className="xw-cash-ic" aria-hidden="true">
        <Ico name="triangle-alert" size={26} />
      </span>
      <p className="xw-cash-q">{t('cash_close_void_question')}</p>
      <Input label={t('cash_close_void_reason')} value={reason} onChange={setReason} maxLength={200} error={error} />
      <div className="xw-wactions" style={{ marginTop: 8 }}>
        <Button fullWidth variant="danger" loading={busy} loadingLabel={t('loading')} onPress={() => void submit()}>
          {t('cash_close_void_confirm')}
        </Button>
        <Button variant="ghost" fullWidth onPress={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
      </div>
    </Modal>
  );
}
