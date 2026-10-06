import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, variantInputSchema, type VariantDto } from '@xiro/shared';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from '@/lib/api';
import { issuesToErrors, toInt } from '@/lib/forms';
import { keys, useVariants } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { useDialogs } from '../Dialogs';
import { Field } from '../Field';
import { FormModal } from '../FormModal';
import { Card, SectionTitle, ToggleRow } from '../Kit';
import { AppText } from '../Text';
import { useAction } from './useAction';

/**
 * Estilos de un servicio (p. ej. "Corte" → "Fade", "Clásico"), cada uno con su precio y, si quieres, su duración. El cliente
 * elige el estilo al reservar. Se administra desde la ficha del servicio.
 */
export function VariantsSection({ itemId, basePrice, baseMinutes, canManage }: { itemId: string; basePrice: number; baseMinutes: number; canManage: boolean }) {
  const { t } = useSettings();
  const { business } = useSession();
  const { confirm, toast } = useDialogs();
  const queryClient = useQueryClient();
  const variants = useVariants(itemId);
  const [editing, setEditing] = useState<VariantDto | 'new' | null>(null);
  const currency = business?.currency ?? 'COP';
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...keys.variants, itemId] });
  const remove = useAction();

  async function del(variant: VariantDto) {
    const ok = await confirm({ title: t('variant_delete_title', { name: variant.name }), message: t('variant_delete_text'), confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    await remove.run(() => api.deleteVariant(variant.id));
    await refresh();
  }

  return (
    <View>
      <SectionTitle>{t('variants_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: 8 }}>
        {t('variants_hint')}
      </AppText>
      {variants.isLoading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
      {variants.data && variants.data.length === 0 ? <AppText tone="muted">{t('variants_empty')}</AppText> : null}
      <View style={{ gap: 8 }}>
        {(variants.data ?? []).map((variant) => (
          <Card key={variant.id} style={variant.active ? undefined : { opacity: 0.6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{variant.name}</AppText>
                <AppText variant="small" tone="muted">
                  {formatMoney(variant.price, currency)} · {t('minutes_short', { minutes: variant.durationMinutes ?? baseMinutes })}
                  {variant.active ? '' : ` · ${t('variant_inactive')}`}
                </AppText>
              </View>
              {canManage ? (
                <>
                  <Button label={t('edit')} variant="secondary" compact onPress={() => setEditing(variant)} />
                  <Button label={t('delete')} variant="ghost" compact onPress={() => void del(variant)} />
                </>
              ) : null}
            </View>
          </Card>
        ))}
      </View>
      {remove.error ? (
        <AppText tone="danger" style={{ marginTop: 8 }}>
          {remove.error}
        </AppText>
      ) : null}
      {canManage ? <Button label={t('variants_add')} icon="add" variant="secondary" compact onPress={() => setEditing('new')} style={{ alignSelf: 'flex-start', marginTop: 10 }} /> : null}
      {editing ? (
        <VariantForm
          itemId={itemId}
          variant={editing === 'new' ? null : editing}
          basePrice={basePrice}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
            toast(t('saved'));
          }}
        />
      ) : null}
    </View>
  );
}

function VariantForm({ itemId, variant, basePrice, onClose, onSaved }: { itemId: string; variant: VariantDto | null; basePrice: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useSettings();
  const save = useAction();
  const [form, setForm] = useState({ name: variant?.name ?? '', description: variant?.description ?? '', price: variant ? String(variant.price) : String(basePrice), minutes: variant?.durationMinutes ? String(variant.durationMinutes) : '', active: variant?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    const body = { name: form.name.trim(), description: form.description.trim(), price: toInt(form.price), durationMinutes: form.minutes ? toInt(form.minutes) : null, active: form.active };
    const parsed = variantInputSchema.safeParse(body);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, t));
    if (!form.price) return setErrors({ price: t('required') });
    setErrors({});
    const saved = await save.run(() => (variant ? api.updateVariant(variant.id, parsed.data) : api.addVariant(itemId, parsed.data)));
    if (saved) await onSaved();
  }

  return (
    <FormModal title={variant ? t('variant_edit') : t('variant_new')} onClose={onClose} footer={<Button label={t('save')} loading={save.busy} onPress={() => void submit()} />}>
      <Field label={`${t('variant_name')} *`} value={form.name} onChangeText={(name) => setForm((c) => ({ ...c, name }))} error={errors.name ?? save.fields.name} maxLength={60} />
      <Field label={t('item_description')} value={form.description} onChangeText={(description) => setForm((c) => ({ ...c, description }))} maxLength={300} multiline />
      <Field label={`${t('item_price')} *`} value={form.price} onChangeText={(price) => setForm((c) => ({ ...c, price: price.replace(/\D/g, '') }))} error={errors.price ?? save.fields.price} keyboardType="number-pad" prefix="$" />
      <Field label={t('variant_minutes')} value={form.minutes} onChangeText={(minutes) => setForm((c) => ({ ...c, minutes: minutes.replace(/\D/g, '') }))} error={errors.durationMinutes ?? save.fields.durationMinutes} hint={t('variant_minutes_hint')} keyboardType="number-pad" />
      <ToggleRow label={t('variant_active')} value={form.active} onChange={(active) => setForm((c) => ({ ...c, active }))} />
      {save.error ? (
        <AppText tone="danger" style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
          {save.error}
        </AppText>
      ) : null}
    </FormModal>
  );
}
