import { useState } from 'react';
import { Ico } from '../icons';
import { Button, Input, Modal } from '.';
import { useWebStyles } from './shared';

type T = (key: string) => string;

export interface VoidSaleResult {
  ok: boolean;
  general?: string;
}

export interface VoidSaleModalProps {
  open: boolean;
  onClose: () => void;
  t: T;
  onSubmit: (reason: string) => Promise<VoidSaleResult>;
}

/**
 * Anular una venta pide SIEMPRE un motivo (no se borra nada: la venta queda marcada "Anulada", con el motivo, en la
 * bitácora). Un solo componente, reutilizado desde "Ventas de hoy" y (más adelante) desde el cierre de caja.
 */
export function VoidSaleModal({ open, onClose, t, onSubmit }: VoidSaleModalProps) {
  useWebStyles();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit() {
    const trimmed = reason.trim();
    if (!trimmed) return setError(t('sale_void_reason_required'));
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
    <Modal open={open} onClose={onClose} title={t('sale_void_title')} closeLabel={t('close')} dismissOnBackdrop={!busy}>
      <span className="xw-cash-ic" aria-hidden="true">
        <Ico name="triangle-alert" size={26} />
      </span>
      <p className="xw-cash-q">{t('sale_void_question')}</p>
      <Input label={t('sale_void_reason')} value={reason} onChange={setReason} maxLength={200} error={error} />
      <div className="xw-wactions" style={{ marginTop: 8 }}>
        <Button fullWidth variant="danger" loading={busy} loadingLabel={t('loading')} onPress={() => void submit()}>
          {t('sale_void_confirm')}
        </Button>
        <Button variant="ghost" fullWidth onPress={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
      </div>
    </Modal>
  );
}
