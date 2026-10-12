import { formatMoney, whatsappLink, type Item, type LoyaltyClientProgress } from '@xiro/shared';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { actorOf, meets } from '@/lib/access';
import { api } from '@/lib/api';
import { apiErrors, toInt } from '@/lib/forms';
import { progressPercent } from '@/lib/loyaltyLogic';
import { flatPages, useAllItems, useInvalidateLoyalty, useLoyaltyClients, useLoyaltyProgram, useLoyaltyRedemptions } from '@/lib/queries';
import { LoadMoreButton } from './PagedFooter';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { CheckRow } from './CheckRow';
import { useDialogs } from './Dialogs';
import { Field } from './Field';
import { Card, Chip, ChipRow, EmptyState } from './Kit';
import { Header, Screen } from './Screen';
import { AppText } from './Text';
import { radius } from './theme';

type Tab = 'config' | 'clients' | 'history';

/**
 * Fidelización en nativo: misma lógica, reglas y endpoints que la Web (Fase 2). Solo el dueño configura el programa;
 * registrar servicios, canjear y ver el historial dependen de los permisos del empleado (lo impone el servidor).
 */
export function LoyaltyPanel() {
  const { t } = useSettings();
  const { user } = useAuthed();
  const actor = actorOf(user);
  const canConfigure = user.role === 'owner';
  const canRedeem = meets(actor, ['loyalty_redeem']);
  const program = useLoyaltyProgram();
  const [tab, setTab] = useState<Tab | null>(null);
  const active: Tab = tab ?? (canConfigure && program.data && !program.data.enabled ? 'config' : 'clients');

  return (
    <Screen header={<Header title={t('loyalty_title')} subtitle={t('loyalty_subtitle')} />}>
      <ChipRow label={t('loyalty_title')}>
        {canConfigure ? <Chip label={t('loyalty_tab_config')} selected={active === 'config'} onPress={() => setTab('config')} /> : null}
        <Chip label={t('loyalty_tab_clients')} selected={active === 'clients'} onPress={() => setTab('clients')} />
        {canRedeem ? <Chip label={t('loyalty_tab_history')} selected={active === 'history'} onPress={() => setTab('history')} /> : null}
      </ChipRow>
      <View style={{ marginTop: 14 }}>
        {program.isLoading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
        {program.isError ? <Button label={t('retry')} variant="secondary" onPress={() => void program.refetch()} /> : null}
        {program.data && active === 'config' ? <ConfigTab /> : null}
        {program.data && active === 'clients' ? <ClientsTab canRedeem={canRedeem} /> : null}
        {program.data && active === 'history' ? <HistoryTab /> : null}
      </View>
    </Screen>
  );
}

function ConfigTab() {
  const { t } = useSettings();
  const { toast } = useDialogs();
  const program = useLoyaltyProgram().data!;
  const items = useAllItems();
  const invalidate = useInvalidateLoyalty();
  const [enabled, setEnabled] = useState(program.enabled);
  const [goal, setGoal] = useState(String(program.goal));
  const [resetOnRedeem, setResetOnRedeem] = useState(program.resetOnRedeem);
  const [rewardMessage, setRewardMessage] = useState(program.rewardMessage);
  const [itemIds, setItemIds] = useState<Set<string>>(new Set(program.itemIds));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const toggleItem = (id: string) =>
    setItemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save() {
    const parsedGoal = toInt(goal);
    if (parsedGoal < 1) return setError(t('loyalty_goal_invalid'));
    setError(undefined);
    setBusy(true);
    try {
      await api.updateLoyaltyProgram({ enabled, goal: parsedGoal, resetOnRedeem, rewardMessage: rewardMessage.trim(), itemIds: [...itemIds] });
      await invalidate();
      toast(t('saved'));
    } catch (e) {
      const result = apiErrors(e, t);
      setError(result.fields.goal ?? result.fields.rewardMessage ?? result.general);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <CheckRow label={t('loyalty_enable_cta')} hint={t('loyalty_enable_hint')} checked={enabled} onChange={setEnabled} />
      <Field label={t('loyalty_goal_label')} value={goal} onChangeText={setGoal} keyboardType="number-pad" maxLength={4} />
      <CheckRow label={t('loyalty_reset_cta')} hint={t('loyalty_reset_hint')} checked={resetOnRedeem} onChange={setResetOnRedeem} />
      <View style={{ height: 10 }} />
      <Field label={t('loyalty_message_label')} value={rewardMessage} onChangeText={setRewardMessage} multiline maxLength={200} hint={t('loyalty_message_hint')} />
      <AppText variant="label" tone="gold">
        {t('loyalty_items_label')}
      </AppText>
      <AppText tone="muted" variant="small" style={{ marginBottom: 6 }}>
        {t('loyalty_items_hint')}
      </AppText>
      {items.data && items.data.length === 0 ? <AppText tone="muted">{t('loyalty_items_empty')}</AppText> : null}
      {items.data?.map((item) => <CheckRow key={item.id} label={item.name} checked={itemIds.has(item.id)} onChange={() => toggleItem(item.id)} />)}
      {error ? (
        <AppText tone="danger" style={{ marginTop: 10 }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      <View style={{ height: 14 }} />
      <Button label={t('save_changes')} onPress={() => void save()} loading={busy} />
    </View>
  );
}

function ProgressBar({ count, goal }: { count: number; goal: number }) {
  const { colors } = useSettings();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={`${count} / ${goal}`} accessibilityValue={{ min: 0, max: goal, now: Math.min(count, goal) }} style={[styles.bar, { backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.barFill, { width: `${progressPercent(count, goal)}%`, backgroundColor: colors.gold }]} />
    </View>
  );
}

function ClientsTab({ canRedeem }: { canRedeem: boolean }) {
  const { t } = useSettings();
  const { business } = useAuthed();
  const { toast } = useDialogs();
  const program = useLoyaltyProgram().data!;
  const clients = useLoyaltyClients();
  const progress = flatPages(clients.data);
  const invalidate = useInvalidateLoyalty();
  const [recordingFor, setRecordingFor] = useState<LoyaltyClientProgress | null>(null);
  const [justEarned, setJustEarned] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  if (!program.enabled) return <AppText tone="muted">{t('loyalty_disabled_hint')}</AppText>;

  async function redeem(clientId: string) {
    setRedeeming(clientId);
    setError(undefined);
    try {
      await api.redeemLoyalty(clientId);
      await invalidate();
    } catch (e) {
      setError(apiErrors(e, t).general);
    } finally {
      setRedeeming(null);
    }
  }

  // Aviso al cliente: abre WhatsApp con el mensaje ya escrito. No es un envío automático: la persona lo toca para mandarlo.
  const notify = (client: LoyaltyClientProgress) => {
    void Linking.openURL(whatsappLink(client.clientPhone!, t('loyalty_whatsapp_message', { business: business.name }))).catch(() => toast(t('unknown_error')));
  };

  return (
    <View style={styles.list}>
      {error ? (
        <AppText tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      {clients.isLoading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
      {clients.data && progress.length === 0 ? <EmptyState icon="star-outline" message={t('loyalty_clients_empty')} /> : null}
      {progress.map((c) => (
        <Card key={c.clientId}>
          <View style={styles.top}>
            <AppText variant="bodyStrong" style={{ flex: 1 }}>
              {c.clientName}
            </AppText>
            <AppText tone="muted" variant="small">
              {c.count} / {c.goal}
            </AppText>
          </View>
          <ProgressBar count={c.count} goal={c.goal} />
          {c.rewardAvailable ? (
            <AppText tone="gold" variant="small" style={{ marginTop: 8 }}>
              {t('loyalty_reward_available')}
            </AppText>
          ) : null}
          {justEarned === c.clientId ? (
            <AppText tone="success" variant="small" style={{ marginTop: 4 }} accessibilityLiveRegion="polite">
              {t('loyalty_just_earned')}
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <Button label={t('loyalty_record_cta')} variant="secondary" compact onPress={() => setRecordingFor(c)} />
            {canRedeem && c.rewardAvailable ? <Button label={t('loyalty_redeem_cta')} compact loading={redeeming === c.clientId} onPress={() => void redeem(c.clientId)} /> : null}
            {canRedeem && c.rewardAvailable && c.clientPhone ? <Button label={t('loyalty_notify_whatsapp_cta')} variant="ghost" compact icon="logo-whatsapp" onPress={() => notify(c)} /> : null}
          </View>
        </Card>
      ))}
      <LoadMoreButton query={clients} />
      {recordingFor ? (
        <RecordServiceModal
          client={recordingFor}
          onClose={() => setRecordingFor(null)}
          onRecorded={async (rewardJustEarned) => {
            if (rewardJustEarned) setJustEarned(recordingFor.clientId);
            setRecordingFor(null);
            await invalidate();
          }}
        />
      ) : null}
    </View>
  );
}

function RecordServiceModal({ client, onClose, onRecorded }: { client: LoyaltyClientProgress; onClose: () => void; onRecorded: (rewardJustEarned: boolean) => Promise<void> }) {
  const { t, colors } = useSettings();
  const { business } = useAuthed();
  const items = useAllItems();
  const [itemId, setItemId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!itemId) return setError(t('required'));
    setError(undefined);
    setBusy(true);
    try {
      const record = await api.createServiceRecord({ clientId: client.clientId, itemId, amount: amount.trim() ? toInt(amount) : undefined, note: note.trim() });
      await onRecorded(record.rewardJustEarned);
    } catch (e) {
      const result = apiErrors(e, t);
      setError(result.general ?? Object.values(result.fields)[0]);
    } finally {
      setBusy(false);
    }
  }

  const chosen: Item | undefined = items.data?.find((item) => item.id === itemId);
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            <AppText variant="title" style={{ marginBottom: 14 }}>
              {t('loyalty_record_title', { name: client.clientName })}
            </AppText>
            <AppText variant="label" tone="gold" style={{ marginBottom: 6 }}>
              {t('loyalty_record_item_label')}
            </AppText>
            {items.data?.map((item) => {
              const on = item.id === itemId;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setItemId(item.id)}
                  style={[styles.option, { borderColor: on ? colors.gold : colors.border, backgroundColor: on ? colors.surfaceAlt : colors.surface }]}>
                  <AppText variant="bodyStrong" style={{ flex: 1 }}>
                    {item.name}
                  </AppText>
                  <AppText tone="muted" variant="small">
                    {formatMoney(item.price, business.currency)}
                  </AppText>
                </Pressable>
              );
            })}
            <View style={{ height: 10 }} />
            <Field label={t('loyalty_record_amount_label')} value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder={chosen ? formatMoney(chosen.price, business.currency) : undefined} hint={t('loyalty_record_amount_hint')} />
            <Field label={t('optional_note')} value={note} onChangeText={setNote} multiline maxLength={300} />
            {error ? (
              <AppText tone="danger" accessibilityLiveRegion="polite" style={{ marginBottom: 10 }}>
                {error}
              </AppText>
            ) : null}
            <Button label={t('loyalty_record_cta')} onPress={() => void submit()} loading={busy} disabled={!itemId} />
            <Button label={t('cancel')} variant="ghost" onPress={onClose} disabled={busy} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function HistoryTab() {
  const { t } = useSettings();
  const redemptions = useLoyaltyRedemptions();
  if (redemptions.isLoading) return <ActivityIndicator accessibilityLabel={t('loading')} />;
  const rows = flatPages(redemptions.data);
  if (rows.length === 0) return <EmptyState icon="gift-outline" message={t('loyalty_history_empty')} />;
  return (
    <View style={styles.list}>
      {rows.map((r) => (
        <Card key={r.id}>
          <AppText variant="small">{t('loyalty_history_row', { name: r.clientName, goal: r.goalAtRedemption })}</AppText>
          <AppText tone="muted" variant="small" style={{ marginTop: 2 }}>
            {new Date(r.redeemedAt).toLocaleDateString()}
          </AppText>
        </Card>
      ))}
      <LoadMoreButton query={redemptions} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  bar: { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  formContent: { padding: 20, paddingBottom: 40 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, marginBottom: 8 },
});
