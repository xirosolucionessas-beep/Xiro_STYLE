import { useQueryClient } from '@tanstack/react-query';
import { can, formatMoney, packageInputSchema, type PackageDto } from '@xiro/shared';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, errorKey } from '@/lib/api';
import { issuesToErrors, toInt } from '@/lib/forms';
import { keys, useItems, usePackages } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { Button } from '../Button';
import { CheckRow } from '../CheckRow';
import { useDialogs } from '../Dialogs';
import { Field } from '../Field';
import { FormModal } from '../FormModal';
import { Card, EmptyState, ToggleRow } from '../Kit';
import { Header, Screen } from '../Screen';
import { AppText } from '../Text';
import { useAction } from './useAction';

/** Paquetes: varios servicios con un precio (y duración) propios, p. ej. "Corte + barba". Se reservan como uno solo. */
export function PackagesPanel() {
  const { t } = useSettings();
  const { user, business } = useSession();
  const { confirm, toast } = useDialogs();
  const queryClient = useQueryClient();
  const packages = usePackages();
  const items = useItems();
  const remove = useAction();
  const [editing, setEditing] = useState<PackageDto | 'new' | null>(null);
  const canManage = user ? can({ role: user.role, permissions: user.permissions }, 'catalog_manage') : false;
  const currency = business?.currency ?? 'COP';
  const nameOf = (id: string) => items.data?.find((i) => i.id === id)?.name ?? '—';
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.packages });

  async function del(pkg: PackageDto) {
    const ok = await confirm({ title: t('pkg_delete_title', { name: pkg.name }), message: t('pkg_delete_text'), confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    await remove.run(() => api.deletePackage(pkg.id));
    await refresh();
  }

  return (
    <Screen header={<Header title={t('pkg_title')} subtitle={t('pkg_subtitle')} right={canManage ? <Button label={t('pkg_new')} icon="add" compact onPress={() => setEditing('new')} /> : undefined} />} refreshing={packages.isRefetching} onRefresh={() => void packages.refetch()}>
      {packages.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} accessibilityLabel={t('loading')} /> : null}
      {packages.isError ? (
        <View style={{ gap: 8 }}>
          <AppText tone="danger">{t(errorKey(packages.error))}</AppText>
          <Button label={t('retry')} variant="secondary" compact onPress={() => void packages.refetch()} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
      {packages.data && packages.data.length === 0 ? <EmptyState icon="gift-outline" message={t('pkg_empty')} /> : null}
      {remove.error ? (
        <AppText tone="danger" accessibilityLiveRegion="polite">
          {remove.error}
        </AppText>
      ) : null}
      <View style={{ gap: 12 }}>
        {(packages.data ?? []).map((pkg) => (
          <Card key={pkg.id} style={pkg.active ? undefined : { opacity: 0.6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppText variant="heading" style={{ flex: 1 }}>
                {pkg.name}
              </AppText>
              <AppText variant="heading" tone="gold">
                {formatMoney(pkg.price, currency)}
              </AppText>
            </View>
            <AppText tone="muted">{pkg.entries.map((e) => nameOf(e.itemId)).join(' + ')}</AppText>
            <AppText variant="small" tone="muted">
              {pkg.durationMinutes ? t('minutes_short', { minutes: pkg.durationMinutes }) : t('pkg_duration_sum')}
              {pkg.visibleOnWeb ? '' : ` · ${t('pkg_hidden')}`}
              {pkg.active ? '' : ` · ${t('variant_inactive')}`}
            </AppText>
            {canManage ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Button label={t('edit')} variant="secondary" compact onPress={() => setEditing(pkg)} />
                <Button label={t('delete')} variant="ghost" compact onPress={() => void del(pkg)} />
              </View>
            ) : null}
          </Card>
        ))}
      </View>
      {editing ? (
        <PackageForm
          pkg={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
            toast(t('saved'));
          }}
        />
      ) : null}
    </Screen>
  );
}

function PackageForm({ pkg, onClose, onSaved }: { pkg: PackageDto | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useSettings();
  const { business } = useSession();
  const items = useItems();
  const save = useAction();
  const currency = business?.currency ?? 'COP';
  const services = (items.data ?? []).filter((i) => i.kind === 'service');
  const [form, setForm] = useState({ name: pkg?.name ?? '', description: pkg?.description ?? '', price: pkg ? String(pkg.price) : '', minutes: pkg?.durationMinutes ? String(pkg.durationMinutes) : '', active: pkg?.active ?? true, visibleOnWeb: pkg?.visibleOnWeb ?? true });
  const [chosen, setChosen] = useState<string[]>(pkg?.entries.map((e) => e.itemId) ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const sum = services.filter((s) => chosen.includes(s.id)).reduce((total, s) => total + s.price, 0);

  async function submit() {
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      price: toInt(form.price),
      durationMinutes: form.minutes ? toInt(form.minutes) : null,
      entries: chosen.map((itemId) => ({ itemId, variantId: null })),
      active: form.active,
      visibleOnWeb: form.visibleOnWeb,
    };
    const parsed = packageInputSchema.safeParse(body);
    if (!parsed.success) {
      const found = issuesToErrors(parsed.error.issues, t);
      return setErrors({ ...found, ...(found.entries ? { entries: t('pkg_err_entries') } : {}) });
    }
    if (!form.price) return setErrors({ price: t('required') });
    setErrors({});
    const saved = await save.run(() => (pkg ? api.updatePackage(pkg.id, parsed.data) : api.createPackage(parsed.data)));
    if (saved) await onSaved();
  }

  return (
    <FormModal title={pkg ? t('pkg_edit') : t('pkg_new')} onClose={onClose} footer={<Button label={t('save')} loading={save.busy} onPress={() => void submit()} />}>
      <Field label={`${t('pkg_name')} *`} value={form.name} onChangeText={(name) => setForm((c) => ({ ...c, name }))} error={errors.name ?? save.fields.name} maxLength={80} />
      <Field label={t('item_description')} value={form.description} onChangeText={(description) => setForm((c) => ({ ...c, description }))} multiline maxLength={500} />
      <AppText variant="label" tone="gold" style={{ marginBottom: 4 }}>
        {t('pkg_services')} *
      </AppText>
      {services.length === 0 ? <AppText tone="muted">{t('appt_no_services')}</AppText> : null}
      {services.map((item) => (
        <CheckRow key={item.id} label={item.name} hint={`${formatMoney(item.price, currency)} · ${t('minutes_short', { minutes: item.durationMinutes })}`} checked={chosen.includes(item.id)} onChange={(on) => setChosen((c) => (on ? [...c, item.id] : c.filter((id) => id !== item.id)))} />
      ))}
      {errors.entries ? (
        <AppText variant="small" tone="danger">
          {errors.entries}
        </AppText>
      ) : null}
      {sum > 0 ? (
        <AppText variant="small" tone="muted" style={{ marginVertical: 6 }}>
          {t('pkg_sum_hint', { total: formatMoney(sum, currency) })}
        </AppText>
      ) : null}
      <Field label={`${t('item_price')} *`} value={form.price} onChangeText={(price) => setForm((c) => ({ ...c, price: price.replace(/\D/g, '') }))} error={errors.price ?? save.fields.price} keyboardType="number-pad" prefix="$" />
      <Field label={t('pkg_minutes')} value={form.minutes} onChangeText={(minutes) => setForm((c) => ({ ...c, minutes: minutes.replace(/\D/g, '') }))} hint={t('pkg_minutes_hint')} error={errors.durationMinutes ?? save.fields.durationMinutes} keyboardType="number-pad" />
      <ToggleRow label={t('pkg_visible')} value={form.visibleOnWeb} onChange={(visibleOnWeb) => setForm((c) => ({ ...c, visibleOnWeb }))} />
      <ToggleRow label={t('variant_active')} value={form.active} onChange={(active) => setForm((c) => ({ ...c, active }))} />
      {save.error ? (
        <AppText tone="danger" style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
          {save.error}
        </AppText>
      ) : null}
    </FormModal>
  );
}
