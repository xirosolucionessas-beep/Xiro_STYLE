import type { Currency } from '@xiro/shared';
import { formatMoney } from '@xiro/shared';
import { useState } from 'react';
import { formatAmountInput, parseAmountInput } from '../money';
import { Ico } from '../icons';
import { Button, Input, Modal } from '.';
import { useWebStyles } from './shared';

type T = (key: string) => string;

export interface CashOpeningResult {
  ok: boolean;
  general?: string;
}

export interface CashOpeningModalProps {
  open: boolean;
  onClose: () => void;
  /** Base ya registrada hoy (0 si aún no se ha abierto la caja). */
  currentAmount: number;
  currency: Currency;
  t: T;
  onSubmit: (input: { amount: number; note: string }) => Promise<CashOpeningResult>;
  /** "Omitir por hoy": cierra sin guardar (no se vuelve a preguntar hasta el día siguiente). */
  onSkip: () => void;
}

/**
 * Modal "Base inicial del día" (sección 5): aparece al entrar por primera vez cada día sin caja abierta, y también
 * al tocar la tarjeta de balance para editar la base de hoy. Un solo componente para ambos casos.
 */
export function CashOpeningModal({ open, onClose, currentAmount, currency, t, onSubmit, onSkip }: CashOpeningModalProps) {
  useWebStyles();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await onSubmit({ amount: parseAmountInput(amount), note: note.trim() });
      if (result.ok) {
        setAmount('');
        setNote('');
      } else {
        setError(result.general ?? t('unknown_error'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('cash_opening_title')} closeLabel={t('close')} dismissOnBackdrop={false}>
      <span className="xw-cash-ic" aria-hidden="true">
        <Ico name="wallet" size={26} />
      </span>
      <p className="xw-cash-q">{t('cash_opening_question')}</p>
      <p className="xw-cash-current">
        {t('cash_current_base')}: <strong>{formatMoney(currentAmount, currency)}</strong>
      </p>

      <Input
        label={t('opening_amount')}
        value={amount}
        onChange={(value) => setAmount(formatAmountInput(value))}
        type="text"
        inputMode="numeric"
        prefix={currency}
      />
      <Input label={t('optional_note')} value={note} onChange={setNote} maxLength={200} />
      {error ? (
        <p className="xw-fmsg" role="alert">
          {error}
        </p>
      ) : null}

      <div className="xw-wactions" style={{ marginTop: 8 }}>
        <Button fullWidth icon={<Ico name="arrow-right" size={18} />} iconPosition="end" loading={busy} loadingLabel={t('loading')} onPress={() => void submit()}>
          {t('start_day')}
        </Button>
        <Button variant="ghost" fullWidth onPress={onSkip}>
          {t('skip_today')}
        </Button>
      </div>
    </Modal>
  );
}
