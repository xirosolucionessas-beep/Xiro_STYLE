import { formatMoney, whatsappLink, type Currency, type Item, type LoyaltyClientProgress, type LoyaltyProgram, type LoyaltyRedemption } from '@xiro/shared';
import { useState } from 'react';
import { Ico } from '../icons';
import { Button, Input, Select } from '../ui';
import { Checkbox, FormMessage } from '../ui/auth';
import { Modal } from '../ui/Modal';
import { KpiRow, type KpiView } from '../ui/Page';
import { useWebStyles } from '../ui/shared';

type T = (key: string, params?: Record<string, string | number>) => string;
type ActionResult = { ok: true } | { ok: false; error: string };

export interface LoyaltyViewProps {
  t: T;
  currency: Currency;
  businessName: string;
  program: LoyaltyProgram;
  items: Item[];
  clientsProgress: LoyaltyClientProgress[];
  redemptions: LoyaltyRedemption[];
  onSaveProgram: (input: { enabled: boolean; goal: number; resetOnRedeem: boolean; rewardMessage: string; itemIds: string[] }) => Promise<ActionResult>;
  onRecordService: (input: { clientId: string; itemId: string; amount?: number; note: string }) => Promise<{ ok: true; rewardJustEarned: boolean } | { ok: false; error: string }>;
  onRedeem: (clientId: string) => Promise<ActionResult>;
  /** Solo el dueño configura el programa (un empleado no ve esa pestaña). */
  canConfigure?: boolean;
  /** Canjear premios y ver el historial de canjes requiere el permiso "loyalty_redeem". */
  canRedeem?: boolean;
}

type Tab = 'config' | 'clients' | 'history';

function TabButton({ id, active, label, onSelect }: { id: Tab; active: boolean; label: string; onSelect: (id: Tab) => void }) {
  return (
    <button type="button" role="tab" id={`xw-loy-tab-${id}`} aria-selected={active} aria-controls={`xw-loy-panel-${id}`} tabIndex={active ? 0 : -1} className={`xw-loy-tab${active ? ' is-active' : ''}`} onClick={() => onSelect(id)}>
      {label}
    </button>
  );
}

/** Config: interruptor general, meta, si se reinicia al canjear, mensaje de premio, y qué items cuentan. */
function ConfigTab({ t, items, program, onSaveProgram }: Pick<LoyaltyViewProps, 't' | 'items' | 'program' | 'onSaveProgram'>) {
  const [enabled, setEnabled] = useState(program.enabled);
  const [goal, setGoal] = useState(String(program.goal));
  const [resetOnRedeem, setResetOnRedeem] = useState(program.resetOnRedeem);
  const [rewardMessage, setRewardMessage] = useState(program.rewardMessage);
  const [itemIds, setItemIds] = useState<Set<string>>(new Set(program.itemIds));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleItem = (id: string) =>
    setItemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save() {
    const parsedGoal = Number.parseInt(goal, 10);
    if (!Number.isFinite(parsedGoal) || parsedGoal < 1) return setError(t('loyalty_goal_invalid'));
    setError(undefined);
    setSaved(false);
    setBusy(true);
    try {
      const result = await onSaveProgram({ enabled, goal: parsedGoal, resetOnRedeem, rewardMessage: rewardMessage.trim(), itemIds: [...itemIds] });
      if (result.ok) setSaved(true);
      else setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="xw-loy-config">
      <Checkbox checked={enabled} onChange={setEnabled}>
        {t('loyalty_enable_cta')}
      </Checkbox>
      <p className="xw-hint">{t('loyalty_enable_hint')}</p>

      <Input label={t('loyalty_goal_label')} value={goal} onChange={setGoal} type="number" inputMode="numeric" name="goal" />
      <Checkbox checked={resetOnRedeem} onChange={setResetOnRedeem}>
        {t('loyalty_reset_cta')}
      </Checkbox>
      <p className="xw-hint">{t('loyalty_reset_hint')}</p>

      <Input label={t('loyalty_message_label')} value={rewardMessage} onChange={setRewardMessage} multiline rows={2} maxLength={200} name="rewardMessage" hint={t('loyalty_message_hint')} />

      <div className="xw-field">
        <span className="xw-label">{t('loyalty_items_label')}</span>
        <p className="xw-hint" style={{ marginTop: 0, marginBottom: 'var(--xw-space-2)' }}>
          {t('loyalty_items_hint')}
        </p>
        {items.length === 0 ? (
          <p className="xw-hint">{t('loyalty_items_empty')}</p>
        ) : (
          <div className="xw-loy-items">
            {items.map((item) => (
              <Checkbox key={item.id} checked={itemIds.has(item.id)} onChange={() => toggleItem(item.id)}>
                {item.name}
              </Checkbox>
            ))}
          </div>
        )}
      </div>

      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button onPress={() => void save()} loading={busy} loadingLabel={t('loading')}>
        {t('save_changes')}
      </Button>
      {saved ? (
        <p className="xw-note" style={{ marginTop: 'var(--xw-space-2)' }}>
          <Ico name="check" size={16} />
          <span>{t('saved')}</span>
        </p>
      ) : null}
    </div>
  );
}

function ProgressBar({ count, goal }: { count: number; goal: number }) {
  const pct = Math.min(100, Math.round((count / goal) * 100));
  return (
    <div className="xw-loy-bar" role="img" aria-label={`${count} / ${goal}`}>
      <div className="xw-loy-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Modal para registrar un servicio realizado y cobrado a un cliente: dispara el sello si el item es elegible. */
function RecordServiceModal({ t, currency, clientName, items, onClose, onSubmit }: { t: T; currency: Currency; clientName: string; items: Item[]; onClose: () => void; onSubmit: (input: { itemId: string; amount?: number; note: string }) => Promise<{ ok: true; rewardJustEarned: boolean } | { ok: false; error: string }> }) {
  const [itemId, setItemId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const selected = items.find((i) => i.id === itemId);

  async function submit() {
    if (!itemId) return setError(t('required'));
    setError(undefined);
    setBusy(true);
    try {
      const parsedAmount = amount.trim() ? Number.parseInt(amount, 10) : undefined;
      const result = await onSubmit({ itemId, amount: parsedAmount, note: note.trim() });
      if (!result.ok) setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('loyalty_record_title', { name: clientName })} closeLabel={t('close')} footer={
      <>
        <Button variant="ghost" onPress={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button onPress={() => void submit()} loading={busy} loadingLabel={t('loading')} disabled={!itemId}>
          {t('loyalty_record_cta')}
        </Button>
      </>
    }>
      <div className="xw-form">
        <Select label={t('loyalty_record_item_label')} value={itemId} onChange={setItemId} placeholder={t('loyalty_record_item_placeholder')} options={items.map((i) => ({ value: i.id, label: i.name }))} required />
        <Input label={t('loyalty_record_amount_label')} value={amount} onChange={setAmount} type="number" inputMode="numeric" name="amount" placeholder={selected ? formatMoney(selected.price, currency) : undefined} hint={t('loyalty_record_amount_hint')} />
        <Input label={t('optional_note')} value={note} onChange={setNote} multiline rows={2} maxLength={300} name="note" />
        {error ? <FormMessage>{error}</FormMessage> : null}
      </div>
    </Modal>
  );
}

function ClientsTab({ t, currency, program, items, clientsProgress, onRecordService, onRedeem, businessName, canRedeem }: Pick<LoyaltyViewProps, 't' | 'currency' | 'program' | 'items' | 'clientsProgress' | 'onRecordService' | 'onRedeem' | 'businessName'> & { canRedeem: boolean }) {
  const [recordingFor, setRecordingFor] = useState<LoyaltyClientProgress | null>(null);
  const [justEarnedFor, setJustEarnedFor] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string>();

  async function recordService(input: { itemId: string; amount?: number; note: string }) {
    if (!recordingFor) return { ok: false as const, error: t('unknown_error') };
    const result = await onRecordService({ clientId: recordingFor.clientId, ...input });
    if (result.ok) {
      if (result.rewardJustEarned) setJustEarnedFor(recordingFor.clientId);
      setRecordingFor(null);
    }
    return result;
  }

  async function redeem(clientId: string) {
    setRedeeming(clientId);
    setRedeemError(undefined);
    const result = await onRedeem(clientId);
    if (!result.ok) setRedeemError(result.error);
    setRedeeming(null);
  }

  if (!program.enabled) {
    return <p className="xw-hint">{t('loyalty_disabled_hint')}</p>;
  }
  if (clientsProgress.length === 0) {
    return <p className="xw-hint">{t('loyalty_clients_empty')}</p>;
  }

  return (
    <div className="xw-loy-clients">
      {redeemError ? <FormMessage>{redeemError}</FormMessage> : null}
      {clientsProgress.map((c) => (
        <div key={c.clientId} className="xw-loy-client-card">
          <div className="xw-loy-client-top">
            <span className="xw-loy-client-name">{c.clientName}</span>
            <span className="xw-loy-client-count">
              {c.count} / {c.goal}
            </span>
          </div>
          <ProgressBar count={c.count} goal={c.goal} />
          {c.rewardAvailable ? (
            <div className="xw-note" style={{ marginTop: 'var(--xw-space-2)' }}>
              <Ico name="crown" size={16} />
              <span>{t('loyalty_reward_available')}</span>
            </div>
          ) : null}
          {justEarnedFor === c.clientId ? (
            <p className="xw-note" style={{ marginTop: 'var(--xw-space-2)' }}>
              <Ico name="check" size={16} />
              <span>{t('loyalty_just_earned')}</span>
            </p>
          ) : null}
          <div className="xw-loy-client-actions">
            <Button size="sm" variant="secondary" onPress={() => setRecordingFor(c)}>
              {t('loyalty_record_cta')}
            </Button>
            {canRedeem && c.rewardAvailable ? (
              <Button size="sm" onPress={() => void redeem(c.clientId)} loading={redeeming === c.clientId} loadingLabel={t('loading')}>
                {t('loyalty_redeem_cta')}
              </Button>
            ) : null}
            {canRedeem && c.rewardAvailable && c.clientPhone ? (
              <Button size="sm" variant="ghost" icon={<Ico name="message-circle" size={16} />} onPress={() => window.open(whatsappLink(c.clientPhone!, t('loyalty_whatsapp_message', { business: businessName })), '_blank', 'noopener,noreferrer')}>
                {t('loyalty_notify_whatsapp_cta')}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      {recordingFor ? <RecordServiceModal t={t} currency={currency} clientName={recordingFor.clientName} items={items} onClose={() => setRecordingFor(null)} onSubmit={recordService} /> : null}
    </div>
  );
}

function HistoryTab({ t, redemptions }: Pick<LoyaltyViewProps, 't' | 'redemptions'>) {
  if (redemptions.length === 0) return <p className="xw-hint">{t('loyalty_history_empty')}</p>;
  return (
    <ul className="xw-loy-history">
      {redemptions.map((r) => (
        <li key={r.id} className="xw-loy-history-row">
          <Ico name="crown" size={18} />
          <span className="xw-loy-history-text">{t('loyalty_history_row', { name: r.clientName, goal: r.goalAtRedemption })}</span>
          <span className="xw-loy-history-date">{new Date(r.redeemedAt).toLocaleDateString()}</span>
        </li>
      ))}
    </ul>
  );
}

export function LoyaltyView({ t, currency, businessName, program, items, clientsProgress, redemptions, onSaveProgram, onRecordService, onRedeem, canConfigure = true, canRedeem = true }: LoyaltyViewProps) {
  useWebStyles();
  const [tab, setTab] = useState<Tab>(program.enabled || !canConfigure ? 'clients' : 'config');

  const kpis: KpiView[] = [
    { id: 'status', icon: 'gift', label: t('sec_loy_kpi_status'), value: program.enabled ? t('sec_loy_on') : t('sec_loy_off') },
    { id: 'goal', icon: 'star', label: t('sec_loy_kpi_goal'), value: String(program.goal) },
    { id: 'rewards', icon: 'crown', label: t('sec_loy_kpi_rewards'), value: String(clientsProgress.filter((c) => c.rewardAvailable).length) },
    ...(canRedeem ? [{ id: 'redeemed', icon: 'circle-check' as const, label: t('sec_loy_kpi_redeemed'), value: String(redemptions.length) }] : []),
  ];

  const tabs: Array<{ id: Tab; label: string }> = [
    ...(canConfigure ? [{ id: 'config' as const, label: t('loyalty_tab_config') }] : []),
    { id: 'clients', label: t('loyalty_tab_clients') },
    ...(canRedeem ? [{ id: 'history' as const, label: t('loyalty_tab_history') }] : []),
  ];

  return (
    <div className="xw-section">
      <KpiRow kpis={kpis} label={t('dash_kpis')} t={t} />

      <div className="xw-panel">
      <div role="tablist" aria-label={t('loyalty_title')} className="xw-loy-tabs">
        {tabs.map((tb) => (
          <TabButton key={tb.id} id={tb.id} active={tab === tb.id} label={tb.label} onSelect={setTab} />
        ))}
      </div>

      <div role="tabpanel" id="xw-loy-panel-config" aria-labelledby="xw-loy-tab-config" hidden={tab !== 'config'}>
        {tab === 'config' ? <ConfigTab t={t} items={items} program={program} onSaveProgram={onSaveProgram} /> : null}
      </div>
      <div role="tabpanel" id="xw-loy-panel-clients" aria-labelledby="xw-loy-tab-clients" hidden={tab !== 'clients'}>
        {tab === 'clients' ? <ClientsTab t={t} currency={currency} program={program} items={items} clientsProgress={clientsProgress} onRecordService={onRecordService} onRedeem={onRedeem} businessName={businessName} canRedeem={canRedeem} /> : null}
      </div>
      <div role="tabpanel" id="xw-loy-panel-history" aria-labelledby="xw-loy-tab-history" hidden={tab !== 'history'}>
        {tab === 'history' ? <HistoryTab t={t} redemptions={redemptions} /> : null}
      </div>
      </div>
    </div>
  );
}
