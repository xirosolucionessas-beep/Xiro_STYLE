import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformBusinessDetail } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '@/lib/api';
import { hasPermission, platformApi, usePlatformSession } from '@/lib/platformApi';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Card } from '@/ui/Kit';
import { formatDateTime, formatNumber, IndicatorMeta, KV, Segmented, StateTag, styles, useSensitiveAction } from '@/ui/platform/parts';
import { errorText, usePlatformText, type PlatformText } from '@/ui/platform/strings';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

/** UUID v4 sin depender de crypto.randomUUID (no existe en todos los motores de React Native). */
function newKey(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export default function PlatformBusiness() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { pt, language } = usePlatformText();
  const router = useRouter();
  const { admin } = usePlatformSession();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['platform', 'business', id], queryFn: () => platformApi.business(String(id)), retry: false, staleTime: 15_000 });
  const reload = () => queryClient.invalidateQueries({ queryKey: ['platform', 'business', id] });
  const b = detail.data;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/platform'));

  return (
    <Screen header={<Header title={b?.name ?? pt('detail_identity')} subtitle={b ? `${b.slug} · ${b.id}` : undefined} onBack={back} />}>
      {detail.error ? <AppText tone="danger">{errorText(pt, detail.error instanceof ApiError ? detail.error.code : undefined)}</AppText> : null}
      {b ? (
        <View style={{ gap: 16 }}>
          <Card>
            <KV label={pt('access')} value={b.accessStatus} strong />
            <KV label={pt('effective_access')} value={b.effectiveAccess ? pt('yes') : pt('no')} />
            <KV label={pt('created')} value={formatDateTime(b.createdAt, language)} />
            <KV label="Tipo / ciudad / zona" value={`${b.type} · ${b.city || '—'}, ${b.country} · ${b.timezone}`} />
            {b.owners.map((o, i) => (
              <KV key={i} label={pt('owners')} value={`${o.name} · ${o.emailMasked ?? '—'} · ${o.phoneMasked ?? '—'}`} />
            ))}
            <View style={[styles.row, { marginTop: 6 }]}>
              <AppText variant="small" tone="muted">
                {pt('last_activity')}: {formatDateTime(b.lastActivityAt.value, language)}
              </AppText>
              <StateTag state={b.lastActivityAt.state} pt={pt} />
            </View>
            <IndicatorMeta indicator={b.lastActivityAt} pt={pt} language={language} />
          </Card>

          <Card>
            <AppText variant="heading">{pt('subscription')}</AppText>
            <KV label="Estado" value={b.subscription.status} strong />
            <KV label={pt('plan')} value={`${b.subscription.plan ?? '—'} · ${b.subscription.platform ?? '—'} · ${b.subscription.paymentMethod ?? '—'}`} />
            <KV label={pt('trial_ends')} value={formatDateTime(b.subscription.trialEndsAt, language)} />
            <KV label={pt('period_ends')} value={formatDateTime(b.subscription.currentPeriodEnd, language)} />
            <KV label={pt('grace_ends')} value={formatDateTime(b.subscription.gracePeriodEndsAt, language)} />
            <KV label={pt('cancel_at_end')} value={b.subscription.cancelAtPeriodEnd ? pt('yes') : pt('no')} />
            <KV label={pt('grant_until')} value={formatDateTime(b.grantAccessEndsAt, language)} />
          </Card>

          <Card>
            <View style={styles.row}>
              <AppText variant="heading" style={styles.flex}>
                {pt('employees')}
              </AppText>
              <StateTag state={b.employees.state} pt={pt} />
            </View>
            {b.employees.value ? (
              <>
                <KV label={pt('employees_owners')} value={formatNumber(b.employees.value.owners, language)} />
                <KV label={pt('employees_active')} value={formatNumber(b.employees.value.employeesActive, language)} />
                <KV label={pt('employees_inactive')} value={formatNumber(b.employees.value.employeesInactive, language)} />
              </>
            ) : null}
            <IndicatorMeta indicator={b.employees} pt={pt} language={language} />
            <View style={[styles.row, { marginTop: 8 }]}>
              <StateTag state={b.employeeHistory.state} pt={pt} />
              <AppText variant="small" tone="muted" style={styles.flex}>
                {b.employeeHistory.note}
              </AppText>
            </View>
            <View style={[styles.row, { marginTop: 4 }]}>
              <StateTag state={b.incidents.state} pt={pt} />
              <AppText variant="small" tone="muted" style={styles.flex}>
                {b.incidents.note}
              </AppText>
            </View>
          </Card>

          {hasPermission(admin, 'business_access_manage') || hasPermission(admin, 'business_deactivate') ? <StatusActions business={b} pt={pt} onDone={reload} /> : null}
          {hasPermission(admin, 'business_extend') ? <GrantForm business={b} pt={pt} onDone={reload} /> : null}
          <Grants business={b} pt={pt} language={language} canRevoke={hasPermission(admin, 'business_extend')} onDone={reload} />

          <Card>
            <AppText variant="heading">{pt('history_title')}</AppText>
            {b.history.length === 0 ? <AppText tone="muted">—</AppText> : null}
            {b.history.map((h) => (
              <View key={h.id} style={{ paddingVertical: 4 }}>
                <AppText variant="small">
                  {formatDateTime(h.createdAt, language)} · {h.action} · {h.outcome} · {h.adminName ?? '—'}
                </AppText>
                {typeof h.details.reason === 'string' ? (
                  <AppText variant="small" tone="muted">
                    {h.details.reason}
                  </AppText>
                ) : null}
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

function StatusActions({ business, pt, onDone }: { business: PlatformBusinessDetail; pt: PlatformText; onDone: () => void }) {
  const { admin } = usePlatformSession();
  const dialogs = useDialogs();
  const [reason, setReason] = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');
  const action = useSensitiveAction(pt);
  const status = business.accessStatus;
  const options: Array<{ key: 'suspend' | 'reactivate' | 'deactivate' | 'restore'; perm: string; danger: boolean }> = [
    ...(status === 'active' ? [{ key: 'suspend' as const, perm: 'business_access_manage', danger: true }] : []),
    ...(status === 'suspended' ? [{ key: 'reactivate' as const, perm: 'business_access_manage', danger: false }] : []),
    ...(status !== 'deactivated' ? [{ key: 'deactivate' as const, perm: 'business_deactivate', danger: true }] : []),
    ...(status === 'deactivated' ? [{ key: 'restore' as const, perm: 'business_deactivate', danger: false }] : []),
  ].filter((o) => hasPermission(admin, o.perm));
  const ready = reason.trim().length >= 10 && confirmSlug.trim().toLowerCase() === business.slug;

  async function go(key: (typeof options)[number]['key']) {
    if (key === 'deactivate' && !(await dialogs.confirm({ title: pt('deactivate'), message: pt('deactivate_confirm'), destructive: true, confirmLabel: pt('confirm') }))) return;
    const ok = await action.run(() => platformApi.changeStatus(business.id, key, { reason: reason.trim(), confirmSlug: confirmSlug.trim() }));
    if (ok) {
      dialogs.toast(pt('action_done'));
      setReason('');
      setConfirmSlug('');
      onDone();
    }
  }

  if (options.length === 0) return null;
  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="heading">{pt('actions')}</AppText>
      <AppText variant="small" tone="muted">
        {pt('suspend_help')}
      </AppText>
      <AppText variant="small" tone="muted">
        {pt('deactivate_help')}
      </AppText>
      <Field label={pt('reason')} value={reason} onChangeText={setReason} multiline maxLength={500} />
      <Field label={`${pt('confirm_slug')}: ${business.slug}`} value={confirmSlug} onChangeText={setConfirmSlug} autoCapitalize="none" />
      <View style={styles.row}>
        {options.map((o) => (
          <Button key={o.key} label={pt(o.key)} variant={o.danger ? 'danger' : 'primary'} compact disabled={!ready} loading={action.busy} onPress={() => void go(o.key)} />
        ))}
      </View>
      {action.ui}
    </Card>
  );
}

function GrantForm({ business, pt, onDone }: { business: PlatformBusinessDetail; pt: PlatformText; onDone: () => void }) {
  const dialogs = useDialogs();
  const [unit, setUnit] = useState<'days' | 'months'>('days');
  const [amount, setAmount] = useState('7');
  const [reason, setReason] = useState('');
  const [supportRef, setSupportRef] = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');
  // Una clave por formulario: si se reintenta o se pulsa dos veces, el servidor devuelve la MISMA concesión.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const action = useSensitiveAction(pt);
  const n = Number.parseInt(amount, 10);
  const valid = Number.isInteger(n) && n >= 1 && n <= (unit === 'days' ? 366 : 24) && reason.trim().length >= 10 && confirmSlug.trim().toLowerCase() === business.slug;
  const paidInForce = business.subscription.paidAccess && (business.subscription.status === 'active' || business.subscription.status === 'trial');

  async function submit() {
    let replayed = false;
    const ok = await action.run(async () => {
      const res = await platformApi.grant(business.id, { unit, amount: n, reason: reason.trim(), supportRef: supportRef.trim() || undefined, idempotencyKey, confirmSlug: confirmSlug.trim() });
      replayed = res.replayed;
    });
    if (ok) {
      dialogs.toast(replayed ? pt('grant_replayed') : pt('grant_done'));
      setIdempotencyKey(newKey());
      setReason('');
      setSupportRef('');
      setConfirmSlug('');
      onDone();
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="heading">{pt('grant_title')}</AppText>
      <AppText variant="small" tone="muted">
        {pt('grant_help')}
      </AppText>
      {paidInForce ? <AppText variant="small" tone="gold">{pt('grant_paid_warning')}</AppText> : null}
      <Segmented
        options={[
          { value: 'days', label: pt('unit_days') },
          { value: 'months', label: pt('unit_months') },
        ]}
        value={unit}
        onChange={setUnit}
      />
      <Field label={`${pt('amount')} (1–${unit === 'days' ? 366 : 24})`} value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" />
      <Field label={pt('reason')} value={reason} onChangeText={setReason} multiline maxLength={500} />
      <Field label={pt('support_ref')} value={supportRef} onChangeText={setSupportRef} maxLength={120} />
      <Field label={`${pt('confirm_slug')}: ${business.slug}`} value={confirmSlug} onChangeText={setConfirmSlug} autoCapitalize="none" />
      <Button label={pt('grant')} compact disabled={!valid || business.accessStatus === 'deactivated'} loading={action.busy} onPress={() => void submit()} />
      {action.ui}
    </Card>
  );
}

function Grants({ business, pt, language, canRevoke, onDone }: { business: PlatformBusinessDetail; pt: PlatformText; language: string; canRevoke: boolean; onDone: () => void }) {
  const dialogs = useDialogs();
  const [reason, setReason] = useState('');
  const action = useSensitiveAction(pt);
  async function revoke(grantId: string) {
    if (!(await dialogs.confirm({ title: pt('revoke'), message: reason, destructive: true, confirmLabel: pt('confirm') }))) return;
    if (await action.run(() => platformApi.revokeGrant(business.id, grantId, reason.trim()))) {
      setReason('');
      onDone();
    }
  }
  return (
    <Card style={{ gap: 8 }}>
      <AppText variant="heading">{pt('grants_title')}</AppText>
      {business.grants.length === 0 ? <AppText tone="muted">—</AppText> : null}
      {business.grants.map((g) => (
        <View key={g.id} style={{ gap: 2, paddingVertical: 4 }}>
          <AppText variant="small">
            +{g.amount} {g.unit === 'days' ? pt('unit_days') : pt('unit_months')} · {formatDateTime(g.startsAt, language)} → {formatDateTime(g.endsAt, language)} · {g.adminName}
            {g.supportRef ? ` · ${g.supportRef}` : ''}
          </AppText>
          <AppText variant="small" tone="muted">
            {g.reason}
            {g.revokedAt ? ` · ${pt('revoked')} ${formatDateTime(g.revokedAt, language)}: ${g.revokeReason ?? ''}` : ''}
          </AppText>
          {canRevoke && !g.revokedAt && Date.parse(g.endsAt) > Date.now() ? <Button label={pt('revoke')} variant="ghost" compact disabled={reason.trim().length < 10} onPress={() => void revoke(g.id)} /> : null}
        </View>
      ))}
      {canRevoke && business.grants.some((g) => !g.revokedAt) ? <Field label={pt('reason')} value={reason} onChangeText={setReason} maxLength={500} /> : null}
      {action.ui}
    </Card>
  );
}
