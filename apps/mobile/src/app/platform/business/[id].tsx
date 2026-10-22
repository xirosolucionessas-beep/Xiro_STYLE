import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccessGrantDto, PlatformBusinessDetail } from '@xiro/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '@/lib/api';
import { hasPermission, platformApi, usePlatformSession } from '@/lib/platformApi';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Field } from '@/ui/Field';
import { Card } from '@/ui/Kit';
import { AccessBadge, Badge, formatDate, formatDateTime, formatNumber, IndicatorMeta, KV, newKey, Segmented, StateTag, styles, Titled, useSensitiveAction } from '@/ui/platform/parts';
import { auditActionText, errorText, hasText, usePlatformText, type PlatformText } from '@/ui/platform/strings';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function PlatformBusiness() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { pt, language } = usePlatformText();
  const router = useRouter();
  const { admin } = usePlatformSession();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['platform', 'business', id], queryFn: () => platformApi.business(String(id)), retry: false, staleTime: 15_000 });
  // Tras una acción confirmada por el servidor se vuelve a consultar TODO el panel (ficha, resumen, bitácora, vista previa).
  const reload = () => queryClient.invalidateQueries({ queryKey: ['platform'] });
  const b = detail.data;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/platform'));

  return (
    <Screen header={<Header title={b?.name ?? pt('detail_identity')} subtitle={b ? `${pt('search_kind_slug')}: ${b.slug}` : undefined} onBack={back} />}>
      {detail.isLoading ? <AppText tone="muted">{pt('loading')}</AppText> : null}
      {detail.error ? (
        <AppText tone="danger" accessibilityRole="alert">
          {errorText(pt, detail.error instanceof ApiError ? detail.error.code : undefined)}
        </AppText>
      ) : null}
      {b ? (
        <View style={{ gap: 16 }}>
          <Summary b={b} pt={pt} language={language} />
          <SubscriptionCard b={b} pt={pt} language={language} />

          {hasPermission(admin, 'business_extend') ? <GrantForm business={b} pt={pt} language={language} onDone={reload} /> : null}
          <Grants business={b} pt={pt} language={language} canRevoke={hasPermission(admin, 'business_extend')} onDone={reload} />
          {hasPermission(admin, 'business_access_manage') || hasPermission(admin, 'business_deactivate') ? <StatusActions business={b} pt={pt} onDone={reload} /> : null}

          <Card style={{ gap: 4 }}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Titled title={pt('employees')} help={pt('employees_help')} pt={pt} />
              </View>
              <StateTag state={b.employees.state} pt={pt} />
            </View>
            {b.employees.value ? (
              <>
                <KV label={pt('employees_owners')} value={formatNumber(b.employees.value.owners, language)} />
                <KV label={pt('employees_active')} value={formatNumber(b.employees.value.employeesActive, language)} strong />
                <KV label={pt('employees_inactive')} value={formatNumber(b.employees.value.employeesInactive, language)} />
              </>
            ) : null}
            <IndicatorMeta indicator={b.employees} pt={pt} language={language} />
            {[b.employeeHistory, b.incidents].map((i, n) => (
              <View key={n} style={[styles.row, { marginTop: 6 }]}>
                <StateTag state={i.state} pt={pt} />
                <AppText variant="small" tone="muted" style={styles.flex}>
                  {i.note}
                </AppText>
              </View>
            ))}
          </Card>

          <Card style={{ gap: 6 }}>
            <Titled title={pt('history_title')} help={pt('history_help')} pt={pt} />
            {b.history.length === 0 ? <AppText tone="muted">{pt('audit_empty')}</AppText> : null}
            {b.history.map((h) => (
              <View key={h.id} style={{ paddingVertical: 4, gap: 2 }}>
                <View style={styles.row}>
                  <AppText variant="bodyStrong" style={styles.flex}>
                    {auditActionText(pt, h.action)}
                  </AppText>
                  <Badge label={pt(`outcome_${h.outcome}`)} tone={h.outcome === 'success' ? 'success' : h.outcome === 'denied' ? 'warning' : 'danger'} />
                </View>
                <AppText variant="small" tone="muted">
                  {formatDateTime(h.createdAt, language)} · {pt('audit_by')} {h.adminName ?? pt('audit_unknown_admin')}
                </AppText>
                {typeof h.details.reason === 'string' ? (
                  <AppText variant="small" tone="muted">
                    {pt('audit_reason')}: {h.details.reason}
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

function Summary({ b, pt, language }: { b: PlatformBusinessDetail; pt: PlatformText; language: string }) {
  const typeKey = `type_${b.type}`;
  return (
    <Card style={{ gap: 4 }}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Titled title={pt('access')} help={`${pt('access_help')}\n${pt(`status_${b.accessStatus}_one`)}: ${pt(`status_${b.accessStatus}_help`)}`} pt={pt} variant="label" />
        </View>
        <AccessBadge status={b.accessStatus} pt={pt} />
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Titled title={pt('effective_access')} help={pt('effective_access_help')} pt={pt} variant="label" />
        </View>
        <Badge label={b.effectiveAccess ? pt('yes') : pt('no')} tone={b.effectiveAccess ? 'success' : 'danger'} icon={b.effectiveAccess ? 'checkmark-circle' : 'close-circle'} />
      </View>
      <KV label={pt('created')} value={formatDateTime(b.createdAt, language)} />
      <KV label={pt('type_location')} value={`${hasText(typeKey) ? pt(typeKey) : b.type} · ${b.city || '—'}, ${b.country} · ${b.timezone}`} />
      <Titled title={pt('owners')} help={pt('owners_help')} pt={pt} variant="label" />
      {b.owners.map((o, i) => (
        <AppText key={i}>
          {o.name} · {o.emailMasked ?? '—'} · {o.phoneMasked ?? '—'}
        </AppText>
      ))}
      <View style={[styles.row, { marginTop: 6 }]}>
        <View style={styles.flex}>
          <Titled title={pt('last_activity')} help={pt('last_activity_help')} pt={pt} variant="label" />
        </View>
        <StateTag state={b.lastActivityAt.state} pt={pt} />
      </View>
      <AppText>{formatDateTime(b.lastActivityAt.value, language)}</AppText>
      <IndicatorMeta indicator={b.lastActivityAt} pt={pt} language={language} />
    </Card>
  );
}

function SubscriptionCard({ b, pt, language }: { b: PlatformBusinessDetail; pt: PlatformText; language: string }) {
  const s = b.subscription;
  const word = (prefix: string, v: string | null) => (v && hasText(`${prefix}_${v}`) ? pt(`${prefix}_${v}` as never) : (v ?? '—'));
  const date = (iso: string | null) => (iso ? formatDate(iso, language) : pt('not_applicable'));
  return (
    <Card style={{ gap: 2 }}>
      <Titled title={pt('subscription')} help={pt('subscription_help')} pt={pt} />
      <KV label={pt('sub_status')} value={pt(`sub_${s.status}`)} strong />
      <AppText variant="small" tone="muted">
        {pt(`sub_${s.status}_help`)}
      </AppText>
      <KV label={pt('plan')} value={`${word('plan', s.plan)} · ${word('platform', s.platform)} · ${word('method', s.paymentMethod)}`} />
      <KV label={pt('trial_ends')} value={date(s.trialEndsAt)} />
      <KV label={pt('period_ends')} value={date(s.currentPeriodEnd)} />
      <KV label={pt('grace_ends')} value={date(s.gracePeriodEndsAt)} />
      <KV label={pt('cancel_at_end')} value={s.cancelAtPeriodEnd ? pt('yes') : pt('no')} />
      <KV label={pt('grant_until')} value={b.grantAccessEndsAt ? formatDate(b.grantAccessEndsAt, language) : pt('not_applicable')} strong />
    </Card>
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
  const slugOk = confirmSlug.trim().toLowerCase() === business.slug;
  const ready = reason.trim().length >= 10 && slugOk;

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
      <Titled title={pt('actions')} pt={pt} />
      <AppText variant="small" tone="muted">
        {pt('suspend_help')}
      </AppText>
      <AppText variant="small" tone="muted">
        {pt('deactivate_help')}
      </AppText>
      <Field label={pt('reason')} value={reason} onChangeText={setReason} multiline maxLength={500} error={reason.length > 0 && reason.trim().length < 10 ? pt('reason_too_short') : undefined} />
      <Field label={`${pt('confirm_slug')}: ${business.slug}`} value={confirmSlug} onChangeText={setConfirmSlug} autoCapitalize="none" error={confirmSlug.length > 0 && !slugOk ? pt('confirmation_mismatch') : undefined} />
      <View style={styles.row}>
        {options.map((o) => (
          <Button key={o.key} label={pt(o.key)} variant={o.danger ? 'danger' : 'primary'} compact disabled={!ready} loading={action.busy} onPress={() => void go(o.key)} />
        ))}
      </View>
      {action.ui}
    </Card>
  );
}

function GrantForm({ business, pt, language, onDone }: { business: PlatformBusinessDetail; pt: PlatformText; language: string; onDone: () => void }) {
  const dialogs = useDialogs();
  const { colors } = useSettings();
  const [unit, setUnit] = useState<'days' | 'months'>('days');
  const [amount, setAmount] = useState('30');
  const [reason, setReason] = useState('');
  const [supportRef, setSupportRef] = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');
  const [done, setDone] = useState<string | null>(null);
  // Una clave por formulario: si se reintenta, se pierde la respuesta o se pulsa dos veces, el servidor devuelve la MISMA concesión.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const action = useSensitiveAction(pt);
  const n = Number.parseInt(amount, 10);
  const max = unit === 'days' ? 366 : 24;
  const amountOk = Number.isInteger(n) && n >= 1 && n <= max;
  const slugOk = confirmSlug.trim().toLowerCase() === business.slug;
  const deactivated = business.accessStatus === 'deactivated';
  const paidInForce = business.subscription.paidAccess && (business.subscription.status === 'active' || business.subscription.status === 'trial');
  // Vista previa calculada por el servidor con la MISMA regla que la concesión real (nunca una estimación del cliente).
  const preview = useQuery({
    queryKey: ['platform', 'grant-preview', business.id, unit, n, business.grantAccessEndsAt],
    queryFn: () => platformApi.grantPreview(business.id, unit, n),
    enabled: amountOk && !deactivated,
    retry: false,
    staleTime: 0,
  });
  const p = preview.data;
  const unitWord = pt(unit === 'days' ? 'unit_days_lc' : 'unit_months_lc');
  const valid = amountOk && reason.trim().length >= 10 && slugOk && !deactivated && Boolean(p);

  async function submit() {
    if (!p) return;
    const current = p.currentAccessEndsAt ? `${formatDate(p.currentAccessEndsAt, language)} (${pt(`preview_source_${p.currentAccessSource}` as never)})` : pt('preview_current_none');
    const message = `${pt('audit_business')}: ${business.name} (${business.slug})\n${pt('preview_current')}: ${current}\n${pt('preview_adds')}: ${n} ${unitWord}\n${pt('preview_new')}: ${formatDate(p.endsAt, language)}`;
    if (!(await dialogs.confirm({ title: pt('grant_confirm_title'), message, confirmLabel: pt('grant') }))) return;
    setDone(null);
    let result: { endsAt: string; replayed: boolean } | null = null;
    const ok = await action.run(async () => {
      const res = await platformApi.grant(business.id, { unit, amount: n, reason: reason.trim(), supportRef: supportRef.trim() || undefined, idempotencyKey, confirmSlug: confirmSlug.trim() });
      result = { endsAt: res.grant.endsAt, replayed: res.replayed };
    });
    const r = result as { endsAt: string; replayed: boolean } | null;
    // Éxito SOLO con la respuesta confirmada del servidor; la fecha mostrada es la que él guardó.
    if (ok && r) {
      const text = r.replayed ? pt('grant_replayed_full', { date: formatDate(r.endsAt, language) }) : pt('grant_done_full', { amount: n, unit: unitWord, business: business.name, date: formatDate(r.endsAt, language) });
      setDone(text);
      dialogs.toast(text);
      setIdempotencyKey(newKey());
      setReason('');
      setSupportRef('');
      setConfirmSlug('');
      onDone();
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <Titled title={pt('grant_title')} help={pt('grant_help')} pt={pt} />
      {deactivated ? <AppText tone="danger">{pt('business_deactivated')}</AppText> : null}
      {paidInForce ? (
        <AppText variant="small" tone="gold">
          {pt('grant_paid_warning')}
        </AppText>
      ) : null}
      <Segmented
        label={pt('amount')}
        options={[
          { value: 'days', label: pt('unit_days') },
          { value: 'months', label: pt('unit_months') },
        ]}
        value={unit}
        onChange={setUnit}
      />
      <Field
        label={pt('amount')}
        hint={pt('amount_range', { max })}
        value={amount}
        onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 3))}
        keyboardType="number-pad"
        error={amount.length > 0 && !amountOk ? pt('amount_range', { max }) : undefined}
      />

      <View style={{ gap: 4, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.goldTint }} accessibilityLiveRegion="polite">
        <AppText variant="label" tone="muted">
          {pt('preview_title')}
        </AppText>
        {!amountOk || deactivated ? (
          <AppText tone="muted">—</AppText>
        ) : preview.isFetching && !p ? (
          <AppText tone="muted">{pt('preview_loading')}</AppText>
        ) : preview.error ? (
          <AppText tone="danger">{errorText(pt, preview.error instanceof ApiError ? preview.error.code : undefined)}</AppText>
        ) : p ? (
          <>
            <KV label={pt('preview_current')} value={p.currentAccessEndsAt ? `${formatDate(p.currentAccessEndsAt, language)} · ${pt(`preview_source_${p.currentAccessSource}` as never)}` : pt('preview_current_none')} />
            <KV label={pt('preview_adds')} value={`+ ${n} ${unitWord}`} />
            <KV label={pt('preview_new')} value={formatDate(p.endsAt, language)} strong />
          </>
        ) : null}
      </View>

      <Field label={pt('reason')} value={reason} onChangeText={setReason} multiline maxLength={500} error={reason.length > 0 && reason.trim().length < 10 ? pt('reason_too_short') : undefined} />
      <Field label={pt('support_ref')} value={supportRef} onChangeText={setSupportRef} maxLength={120} />
      <Field label={`${pt('confirm_slug')}: ${business.slug}`} value={confirmSlug} onChangeText={setConfirmSlug} autoCapitalize="none" error={confirmSlug.length > 0 && !slugOk ? pt('confirmation_mismatch') : undefined} />
      <Button label={pt('grant')} icon="calendar-outline" compact disabled={!valid} loading={action.busy} onPress={() => void submit()} />
      {action.ui}
      {done ? (
        <View style={[styles.row, { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.success }]} accessibilityRole="alert">
          <Badge label={pt('outcome_success')} tone="success" icon="checkmark-circle" />
          <AppText style={styles.flex}>{done}</AppText>
        </View>
      ) : null}
    </Card>
  );
}

function grantState(g: AccessGrantDto): 'revoked' | 'grant_active' | 'grant_future' | 'grant_ended' {
  if (g.revokedAt) return 'revoked';
  const now = Date.now();
  if (Date.parse(g.startsAt) > now) return 'grant_future';
  return Date.parse(g.endsAt) > now ? 'grant_active' : 'grant_ended';
}

function Grants({ business, pt, language, canRevoke, onDone }: { business: PlatformBusinessDetail; pt: PlatformText; language: string; canRevoke: boolean; onDone: () => void }) {
  const dialogs = useDialogs();
  const [reason, setReason] = useState('');
  const action = useSensitiveAction(pt);
  async function revoke(grantId: string) {
    if (!(await dialogs.confirm({ title: pt('revoke'), message: reason, destructive: true, confirmLabel: pt('confirm') }))) return;
    if (await action.run(() => platformApi.revokeGrant(business.id, grantId, reason.trim()))) {
      dialogs.toast(pt('action_done'));
      setReason('');
      onDone();
    }
  }
  const tone = { revoked: 'neutral', grant_active: 'success', grant_future: 'gold', grant_ended: 'neutral' } as const;
  return (
    <Card style={{ gap: 8 }}>
      <Titled title={pt('grants_title')} pt={pt} />
      {business.grants.length === 0 ? <AppText tone="muted">{pt('grants_empty')}</AppText> : null}
      {business.grants.map((g) => {
        const state = grantState(g);
        return (
          <View key={g.id} style={{ gap: 2, paddingVertical: 4 }}>
            <View style={styles.row}>
              <AppText variant="bodyStrong" style={styles.flex}>
                + {g.amount} {pt(g.unit === 'days' ? 'unit_days_lc' : 'unit_months_lc')} · {formatDate(g.startsAt, language)} → {formatDate(g.endsAt, language)}
              </AppText>
              <Badge label={pt(state)} tone={tone[state]} />
            </View>
            <AppText variant="small" tone="muted">
              {g.reason} · {pt('audit_by')} {g.adminName}
              {g.supportRef ? ` · ${g.supportRef}` : ''}
              {g.revokedAt ? ` · ${pt('revoked')} ${formatDateTime(g.revokedAt, language)}: ${g.revokeReason ?? ''}` : ''}
            </AppText>
            {canRevoke && !g.revokedAt && Date.parse(g.endsAt) > Date.now() ? <Button label={pt('revoke')} variant="ghost" compact disabled={reason.trim().length < 10} onPress={() => void revoke(g.id)} /> : null}
          </View>
        );
      })}
      {canRevoke && business.grants.some((g) => !g.revokedAt && Date.parse(g.endsAt) > Date.now()) ? <Field label={pt('revoke_reason')} value={reason} onChangeText={setReason} maxLength={500} /> : null}
      {action.ui}
    </Card>
  );
}
