import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, type ClassificationEntry } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { toInt } from '@/lib/forms';
import { keys, useClassification } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { useDialogs } from '../Dialogs';
import { Field } from '../Field';
import { Card, Chip, ChipRow, EmptyState } from '../Kit';
import { Header, Screen } from '../Screen';
import { AppText } from '../Text';
import { useAction } from './useAction';

interface Choice {
  kind: 'service' | 'product';
  minutes: string;
}

/**
 * "Revisa tus servicios y productos": una sola vez, el dueño confirma qué es servicio (se agenda, tiene duración) y qué es
 * producto (se vende y tiene existencias) de todo lo que ya tenía cargado. La clasificación inicial es solo una propuesta:
 * los artículos con existencias se sugieren como producto y los demás como servicio.
 */
export function ReviewItemsPanel() {
  const { t } = useSettings();
  const { business } = useSession();
  const { toast } = useDialogs();
  const router = useRouter();
  const queryClient = useQueryClient();
  const entries = useClassification();
  const save = useAction();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const currency = business?.currency ?? 'COP';

  useEffect(() => {
    if (!entries.data) return;
    setChoices((current) => {
      const next = { ...current };
      for (const e of entries.data) next[e.id] ??= { kind: e.kind, minutes: String(e.durationMinutes) };
      return next;
    });
  }, [entries.data]);

  const list: ClassificationEntry[] = entries.data ?? [];
  const setKind = (id: string, kind: 'service' | 'product') => setChoices((c) => ({ ...c, [id]: { ...(c[id] ?? { minutes: '30' }), kind } }));
  const setAll = (kind: 'suggested' | 'service' | 'product') => setChoices(Object.fromEntries(list.map((e) => [e.id, { kind: kind === 'suggested' ? e.suggestedKind : kind, minutes: choices[e.id]?.minutes ?? String(e.durationMinutes) }])));

  async function confirmAll() {
    const payload = list.map((e) => {
      const c = choices[e.id] ?? { kind: e.kind, minutes: String(e.durationMinutes) };
      const minutes = toInt(c.minutes);
      return { itemId: e.id, kind: c.kind, ...(c.kind === 'service' && minutes >= 5 && minutes <= 720 ? { durationMinutes: minutes } : {}) };
    });
    const bad = list.find((e) => choices[e.id]?.kind === 'service' && (toInt(choices[e.id]!.minutes) < 5 || toInt(choices[e.id]!.minutes) > 720));
    if (bad) return save.setError(t('review_err_minutes', { name: bad.name }));
    const saved = await save.run(() => api.confirmClassification(payload));
    if (!saved) return;
    await Promise.all([queryClient.invalidateQueries({ queryKey: keys.classification }), queryClient.invalidateQueries({ queryKey: keys.items }), queryClient.invalidateQueries({ queryKey: keys.categories })]);
    toast(t('review_done', { count: saved.confirmed }));
    router.back();
  }

  return (
    <Screen header={<Header title={t('review_title')} subtitle={t('review_subtitle')} />} footer={list.length > 0 ? <Button label={t('review_confirm_all', { count: list.length })} loading={save.busy} onPress={() => void confirmAll()} /> : undefined}>
      {entries.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('loading')} /> : null}
      {entries.isError ? (
        <View style={{ gap: 8 }}>
          <AppText tone="danger">{t(errorKey(entries.error))}</AppText>
          <Button label={t('retry')} variant="secondary" compact onPress={() => void entries.refetch()} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
      {entries.data && list.length === 0 ? <EmptyState icon="checkmark-circle-outline" message={t('review_all_done')} /> : null}
      {list.length > 0 ? (
        <>
          <AppText tone="muted" style={{ marginBottom: 10 }}>
            {t('review_intro')}
          </AppText>
          <ChipRow label={t('review_bulk')}>
            <Chip label={t('review_bulk_suggested')} onPress={() => setAll('suggested')} />
            <Chip label={t('review_bulk_services')} onPress={() => setAll('service')} />
            <Chip label={t('review_bulk_products')} onPress={() => setAll('product')} />
          </ChipRow>
          {save.error ? (
            <AppText tone="danger" style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
              {save.error}
            </AppText>
          ) : null}
          <View style={{ gap: 10, marginTop: 10 }}>
            {list.map((entry) => {
              const choice = choices[entry.id] ?? { kind: entry.kind, minutes: String(entry.durationMinutes) };
              return (
                <Card key={entry.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <AppText variant="bodyStrong">{entry.name}</AppText>
                      <AppText variant="small" tone="muted">
                        {entry.categoryName} · {formatMoney(entry.price, currency)} · {t('review_stock', { count: entry.stock })}
                      </AppText>
                    </View>
                  </View>
                  <ChipRow label={entry.name}>
                    <Chip label={`${t('kind_service')}${entry.suggestedKind === 'service' ? ` · ${t('suggested')}` : ''}`} selected={choice.kind === 'service'} onPress={() => setKind(entry.id, 'service')} />
                    <Chip label={`${t('kind_product')}${entry.suggestedKind === 'product' ? ` · ${t('suggested')}` : ''}`} selected={choice.kind === 'product'} onPress={() => setKind(entry.id, 'product')} />
                  </ChipRow>
                  {choice.kind === 'service' ? <Field label={t('review_minutes')} value={choice.minutes} onChangeText={(minutes) => setChoices((c) => ({ ...c, [entry.id]: { ...choice, minutes: minutes.replace(/\D/g, '') } }))} keyboardType="number-pad" maxLength={3} /> : null}
                </Card>
              );
            })}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
