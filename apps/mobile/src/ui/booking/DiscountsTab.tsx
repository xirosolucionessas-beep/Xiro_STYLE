import { useQueryClient } from '@tanstack/react-query';
import { computeDiscount, formatMoney, type BookingAdminSettings, type Currency, type DiscountCodeDto, type DiscountCodeInput } from '@xiro/shared';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { keys, useDiscountCodes } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useDialogs } from '../Dialogs';
import { Field } from '../Field';
import { EmptyState } from '../Kit';
import { Button, Card, Chip, ChipRow, SectionTitle, ToggleRow } from './PanelKit';
import { AppText } from '../Text';
import { useAction } from './useAction';

/** Vigencia rápida al crear un código: sin fecha de fin, o N días desde hoy. */
const VALIDITY = [null, 7, 30, 90] as const;
const digits = (text: string) => text.replace(/\D/g, '').slice(0, 10);

interface Draft {
  code: string;
  description: string;
  kind: 'percent' | 'fixed';
  value: string;
  minTotal: string;
  maxUses: string;
  oncePerClient: boolean;
  days: (typeof VALIDITY)[number];
}
const EMPTY: Draft = { code: '', description: '', kind: 'percent', value: '', minTotal: '', maxUses: '', oncePerClient: false, days: null };

/**
 * Códigos de descuento (Fase 4): el negocio crea códigos para compartir ("VERANO10"); quien reserva lo escribe en el resumen y el
 * servidor valida, descuenta y cuenta cada uso. Sin activarlos en Reglas, la página no muestra el campo.
 */
export function DiscountsTab({ data, onGoTab }: { data: BookingAdminSettings; onGoTab: (tab: 'rules') => void }) {
  const { t } = useSettings();
  const { business } = useSession();
  const currency = (business?.currency ?? 'COP') as Currency;
  const { confirm, toast } = useDialogs();
  const queryClient = useQueryClient();
  const codes = useDiscountCodes();
  const save = useAction();
  const rowAction = useAction();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const enabled = data.settings.discountCodesEnabled;
  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.discountCodes });

  async function create() {
    const body: DiscountCodeInput = {
      code: draft.code,
      description: draft.description,
      kind: draft.kind,
      value: Number(draft.value || 0),
      minTotal: Number(draft.minTotal || 0),
      maxUses: draft.maxUses ? Number(draft.maxUses) : null,
      oncePerClient: draft.oncePerClient,
      endsAt: draft.days ? new Date(Date.now() + draft.days * 86_400_000).toISOString() : null,
    };
    const created = await save.run(() => api.createDiscountCode(body));
    if (!created) return;
    setDraft(EMPTY);
    await refresh();
    toast(t('discounts_created', { code: created.code }));
  }

  const inputOf = (code: DiscountCodeDto, over: Partial<DiscountCodeInput>): DiscountCodeInput => ({
    code: code.code,
    description: code.description,
    kind: code.kind,
    value: code.value,
    minTotal: code.minTotal,
    maxUses: code.maxUses,
    oncePerClient: code.oncePerClient,
    startsAt: code.startsAt,
    endsAt: code.endsAt,
    active: code.active,
    ...over,
  });

  async function toggle(code: DiscountCodeDto, active: boolean) {
    if (await rowAction.run(() => api.updateDiscountCode(code.id, inputOf(code, { active })))) await refresh();
  }

  async function remove(code: DiscountCodeDto) {
    const ok = await confirm({ title: t('discounts_delete'), message: t('discounts_delete_confirm', { code: code.code }), confirmLabel: t('discounts_delete'), destructive: true });
    if (ok && (await rowAction.run(() => api.deleteDiscountCode(code.id).then(() => true)))) await refresh();
  }

  const valueLabel = (code: Pick<DiscountCodeDto, 'kind' | 'value'>) => (code.kind === 'percent' ? `${code.value}%` : formatMoney(code.value, currency));
  const example = Number(draft.value) > 0 ? computeDiscount(100_000, { kind: draft.kind, value: Number(draft.value), minTotal: 0 }) : 0;

  return (
    <View style={{ gap: 12 }}>
      <AppText tone="muted">{t('discounts_hint')}</AppText>
      {!enabled ? (
        <Card>
          <AppText variant="bodyStrong">{t('discounts_off_title')}</AppText>
          <AppText variant="small" tone="muted">
            {t('discounts_off_text')}
          </AppText>
          <Button label={t('discounts_go_rules')} variant="secondary" compact onPress={() => onGoTab('rules')} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
        </Card>
      ) : null}

      <SectionTitle>{t('discounts_new_title')}</SectionTitle>
      <Card>
        <Field label={t('discounts_code')} value={draft.code} onChangeText={(code) => patch({ code: code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30) })} autoCapitalize="characters" autoCorrect={false} error={save.fields.code} hint={t('discounts_code_hint')} />
        <Field label={t('discounts_description')} value={draft.description} onChangeText={(description) => patch({ description })} maxLength={120} error={save.fields.description} />
        <ChipRow label={t('discounts_kind')}>
          <Chip label={t('discounts_kind_percent')} selected={draft.kind === 'percent'} onPress={() => patch({ kind: 'percent' })} />
          <Chip label={t('discounts_kind_fixed')} selected={draft.kind === 'fixed'} onPress={() => patch({ kind: 'fixed' })} />
        </ChipRow>
        <Field
          label={draft.kind === 'percent' ? t('discounts_value_percent') : t('discounts_value_fixed')}
          value={draft.value}
          onChangeText={(value) => patch({ value: digits(value) })}
          keyboardType="number-pad"
          error={save.fields.value}
          hint={example > 0 ? t('discounts_example', { total: formatMoney(100_000, currency), amount: formatMoney(example, currency) }) : undefined}
        />
        <Field label={t('discounts_min_total')} value={draft.minTotal} onChangeText={(minTotal) => patch({ minTotal: digits(minTotal) })} keyboardType="number-pad" error={save.fields.minTotal} hint={t('discounts_min_total_hint')} />
        <Field label={t('discounts_max_uses')} value={draft.maxUses} onChangeText={(maxUses) => patch({ maxUses: digits(maxUses).slice(0, 7) })} keyboardType="number-pad" error={save.fields.maxUses} hint={t('discounts_max_uses_hint')} />
        <ToggleRow label={t('discounts_once_per_client')} value={draft.oncePerClient} onChange={(oncePerClient) => patch({ oncePerClient })} />
        <AppText variant="label" tone="muted" style={{ marginTop: 8 }}>
          {t('discounts_validity')}
        </AppText>
        <ChipRow label={t('discounts_validity')}>
          {VALIDITY.map((days) => (
            <Chip key={String(days)} label={days ? t('rules_days', { days }) : t('discounts_validity_none')} selected={draft.days === days} onPress={() => patch({ days })} />
          ))}
        </ChipRow>
        {save.error ? (
          <AppText tone="danger" accessibilityLiveRegion="polite">
            {save.error}
          </AppText>
        ) : null}
        <Button label={t('discounts_create')} loading={save.busy} disabled={draft.code.length < 3 || !draft.value} onPress={() => void create()} style={{ marginTop: 8 }} />
      </Card>

      <SectionTitle>{t('discounts_list_title')}</SectionTitle>
      {rowAction.error ? (
        <AppText tone="danger" accessibilityLiveRegion="polite">
          {rowAction.error}
        </AppText>
      ) : null}
      {codes.isLoading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
      {codes.isError ? <AppText tone="danger">{t(errorKey(codes.error))}</AppText> : null}
      {codes.data && codes.data.length === 0 ? <EmptyState icon="pricetag-outline" message={t('discounts_empty')} /> : null}
      {codes.data?.map((code) => {
        const expired = code.endsAt !== null && Date.parse(code.endsAt) < Date.now();
        const exhausted = code.maxUses !== null && code.uses >= code.maxUses;
        return (
          <Card key={code.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppText variant="heading" style={{ flex: 1 }}>
                {code.code}
              </AppText>
              <AppText variant="bodyStrong" tone="gold">
                {valueLabel(code)}
              </AppText>
            </View>
            {code.description ? <AppText tone="muted">{code.description}</AppText> : null}
            <AppText variant="small" tone="muted">
              {[
                code.maxUses !== null ? t('discounts_uses_of', { uses: code.uses, max: code.maxUses }) : t('discounts_uses', { uses: code.uses }),
                code.minTotal > 0 ? t('discounts_min_short', { amount: formatMoney(code.minTotal, currency) }) : '',
                code.oncePerClient ? t('discounts_once_short') : '',
                code.endsAt ? t('discounts_until', { date: new Date(code.endsAt).toLocaleDateString() }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
            {expired || exhausted ? (
              <AppText variant="small" tone="danger">
                {t(expired ? 'discounts_expired' : 'discounts_exhausted')}
              </AppText>
            ) : null}
            <ToggleRow label={t('discounts_active')} value={code.active} onChange={(active) => void toggle(code, active)} />
            <Button label={t('discounts_delete')} variant="secondary" compact disabled={rowAction.busy} onPress={() => void remove(code)} style={{ alignSelf: 'flex-start' }} />
          </Card>
        );
      })}
    </View>
  );
}
