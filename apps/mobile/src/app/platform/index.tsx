import { useQuery } from '@tanstack/react-query';
import { PLATFORM_SEARCH_KINDS, type PlatformGrouping, type PlatformSearchKind, type PlatformSeries, type PlatformSearchResult } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '@/lib/api';
import { hasPermission, platformApi, usePlatformSession } from '@/lib/platformApi';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Card } from '@/ui/Kit';
import { BarChart, formatDateTime, formatNumber, IndicatorMeta, KV, Segmented, Stat, StateTag, styles } from '@/ui/platform/parts';
import { errorText, usePlatformText, type PlatformText } from '@/ui/platform/strings';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function PlatformHome() {
  const { token } = usePlatformSession();
  return token ? <Dashboard /> : <Login />;
}

function Login() {
  const { pt } = usePlatformText();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await platformApi.login(email.trim(), password, totp.trim());
      setPassword('');
    } catch (e) {
      setError(errorText(pt, e instanceof ApiError ? e.code : undefined));
    } finally {
      setBusy(false);
      setTotp('');
    }
  }

  return (
    <Screen header={<Header root title={pt('login_title')} subtitle={pt('login_hint')} />}>
      <Card style={{ gap: 12 }}>
        <Field label={pt('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="username" />
        <Field label={pt('password')} value={password} onChangeText={setPassword} password autoComplete="current-password" />
        <Field label={pt('totp')} value={totp} onChangeText={setTotp} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
        {error ? (
          <AppText tone="danger" accessibilityRole="alert">
            {error}
          </AppText>
        ) : null}
        <Button label={pt('sign_in')} loading={busy} disabled={!email || !password || !/^\d{6}$/.test(totp.trim())} onPress={() => void submit()} />
        <AppText variant="small" tone="muted">
          {pt('session_memory')}
        </AppText>
      </Card>
    </Screen>
  );
}

const PERIODS = { last_7: 7, last_30: 30, last_90: 90, last_365: 365 } as const;
const localTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota';
  } catch {
    return 'America/Bogota';
  }
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function Dashboard() {
  const { pt, language } = usePlatformText();
  const { admin } = usePlatformSession();
  const router = useRouter();
  const [period, setPeriod] = useState<keyof typeof PERIODS>('last_30');
  const [series, setSeries] = useState<PlatformSeries>('new_businesses');
  const [grouping, setGrouping] = useState<PlatformGrouping>('day');
  const tz = localTz();
  // "Hasta hoy" en la zona elegida lo calcula el servidor; aquí solo el inicio (aprox. por días UTC, ambos extremos incluidos).
  const from = isoDay(new Date(Date.now() - (PERIODS[period] - 1) * 86_400_000));
  const canMetrics = hasPermission(admin, 'metrics_view');

  // Refresco moderado (60 s) y sin reintentos en bucle: el panel nunca debe cargar la base que usan los negocios.
  const overview = useQuery({ queryKey: ['platform', 'overview', from, tz], queryFn: () => platformApi.overview({ from, tz }), enabled: canMetrics, refetchInterval: 60_000, staleTime: 30_000, retry: 1 });
  const chart = useQuery({ queryKey: ['platform', 'series', series, grouping, from, tz], queryFn: () => platformApi.series(series, grouping, { from, tz }), enabled: canMetrics, staleTime: 60_000, retry: 1 });
  const o = overview.data;

  return (
    <Screen
      header={
        <Header
          root
          title={pt('title')}
          subtitle={admin ? `${admin.name} · ${admin.isFounder ? 'founder' : admin.permissions.join(', ')}` : pt('subtitle')}
          right={<Button label={pt('sign_out')} variant="ghost" compact onPress={() => void platformApi.logout()} />}
        />
      }>
      {hasPermission(admin, 'businesses_view') ? <Search pt={pt} onOpen={(id) => router.push(`/platform/business/${id}`)} /> : null}
      {hasPermission(admin, 'audit_view') ? (
        <View style={[styles.row, { marginTop: 12 }]}>
          <Button label={pt('audit_title')} variant="secondary" compact onPress={() => router.push('/platform/audit')} />
        </View>
      ) : null}

      {!canMetrics ? null : (
        <View style={styles.section}>
          <AppText variant="heading">{pt('overview')}</AppText>
          <Segmented options={(Object.keys(PERIODS) as Array<keyof typeof PERIODS>).map((k) => ({ value: k, label: pt(k) }))} value={period} onChange={setPeriod} />
          <AppText variant="small" tone="muted">
            {pt('timezone')}: {tz}
          </AppText>
          {overview.error ? <AppText tone="danger">{errorText(pt, overview.error instanceof ApiError ? overview.error.code : undefined)}</AppText> : null}
          {o ? (
            <>
              <View style={styles.grid}>
                <Stat label={pt('businesses_total')} indicator={o.businesses.total} pt={pt} language={language} />
                <Stat label={pt('businesses_new')} indicator={o.businesses.newInPeriod} pt={pt} language={language} />
                <Stat
                  label={pt('access')}
                  indicator={o.businesses.byAccessStatus}
                  pt={pt}
                  language={language}
                  render={() => (
                    <View>
                      {(['active', 'suspended', 'deactivated'] as const).map((k) => (
                        <KV key={k} label={pt(`status_${k}`)} value={formatNumber(o.businesses.byAccessStatus.value![k], language)} />
                      ))}
                    </View>
                  )}
                />
              </View>
              <AppText variant="heading" style={{ marginTop: 8 }}>
                {pt('subs_title')}
              </AppText>
              <View style={styles.grid}>
                <Stat
                  label={pt('subs_title')}
                  indicator={o.subscriptions.byStatus}
                  pt={pt}
                  language={language}
                  render={() => (
                    <View>
                      {(['none', 'trial', 'active', 'past_due', 'expired', 'canceled'] as const).map((k) => (
                        <KV key={k} label={pt(`sub_${k}`)} value={formatNumber(o.subscriptions.byStatus.value![k], language)} />
                      ))}
                      <KV label={pt('sub_with_access')} value={formatNumber(o.subscriptions.byStatus.value!.withAccess, language)} strong />
                    </View>
                  )}
                />
                <Stat label={pt('renewing_7')} indicator={o.subscriptions.renewingNext7Days} pt={pt} language={language} />
                <Stat label={pt('cancelling')} indicator={o.subscriptions.cancelAtPeriodEnd} pt={pt} language={language} />
                <Stat label={pt('active_grants')} indicator={o.subscriptions.activeAccessGrants} pt={pt} language={language} />
                <Stat
                  label={pt('payments')}
                  indicator={o.subscriptions.paymentsInPeriod}
                  pt={pt}
                  language={language}
                  render={() =>
                    o.subscriptions.paymentsInPeriod.value!.length === 0 ? (
                      <AppText>{pt('no_payments')}</AppText>
                    ) : (
                      <View>
                        {o.subscriptions.paymentsInPeriod.value!.map((p) => (
                          <KV key={p.currency} label={`${p.currency} · ${p.count}`} value={formatNumber(p.amount, language)} />
                        ))}
                      </View>
                    )
                  }
                />
              </View>

              <Card style={{ gap: 8, marginTop: 8 }}>
                <AppText variant="heading">{pt('chart_title')}</AppText>
                <Segmented
                  options={(['new_businesses', 'trials_started', 'payments', 'access_grants'] as const).map((k) => ({ value: k, label: pt(`series_${k}`) }))}
                  value={series}
                  onChange={setSeries}
                />
                <Segmented options={(['day', 'week', 'month'] as const).map((k) => ({ value: k, label: pt(`group_${k}`) }))} value={grouping} onChange={setGrouping} />
                {chart.error ? <AppText tone="danger">{errorText(pt, chart.error instanceof ApiError ? chart.error.code : undefined)}</AppText> : null}
                {chart.data ? (
                  <>
                    <BarChart buckets={chart.data.buckets} language={language} />
                    <IndicatorMeta indicator={chart.data} pt={pt} language={language} />
                  </>
                ) : null}
              </Card>

              <AppText variant="heading" style={{ marginTop: 8 }}>
                {pt('health')}
              </AppText>
              <Card>
                {o.health.map((h) => (
                  <KV key={h.name} label={`${h.name} — ${h.detail}`} value={`${h.state}${h.latencyMs !== null ? ` · ${h.latencyMs} ms` : ''}`} />
                ))}
              </Card>
              <View style={styles.grid}>
                <Stat
                  label={pt('traffic')}
                  indicator={o.traffic}
                  pt={pt}
                  language={language}
                  render={() => {
                    const v = o.traffic.value!;
                    const ms = (x: number | null) => (x === null ? '—' : `≤${x}`);
                    return (
                      <View>
                        <KV label={pt('requests')} value={formatNumber(v.requests, language)} />
                        <KV label={pt('errors')} value={`${formatNumber(v.errors4xx, language)} / ${formatNumber(v.errors5xx, language)}`} />
                        <KV label={pt('latency')} value={`${ms(v.p50Ms)} / ${ms(v.p95Ms)} / ${ms(v.p99Ms)} ms`} />
                        <KV label="Desde / since" value={formatDateTime(v.since, language)} />
                      </View>
                    );
                  }}
                />
                <Stat
                  label={pt('pool')}
                  indicator={o.databasePool}
                  pt={pt}
                  language={language}
                  render={() => <AppText>{`${o.databasePool.value!.total} total · ${o.databasePool.value!.idle} idle · ${o.databasePool.value!.waiting} waiting`}</AppText>}
                />
              </View>
              <Card style={{ gap: 6 }}>
                <AppText variant="heading">{pt('unavailable_title')}</AppText>
                {o.unavailable.map((u) => (
                  <View key={u.key} style={styles.row}>
                    <StateTag state="unavailable" pt={pt} />
                    <AppText variant="small" style={styles.flex}>
                      {u.key}: {u.reason}
                    </AppText>
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function Search({ pt, onOpen }: { pt: PlatformText; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState<PlatformSearchKind>('email');
  const [q, setQ] = useState('');
  const [result, setResult] = useState<PlatformSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Búsqueda SOLO al presionar "Buscar" (no a cada tecla): cada búsqueda es una lectura auditada.
  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await platformApi.search(kind, q.trim()));
    } catch (e) {
      setError(errorText(pt, e instanceof ApiError ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="heading">{pt('search_title')}</AppText>
      <Segmented options={PLATFORM_SEARCH_KINDS.map((k) => ({ value: k, label: pt(`search_kind_${k}`) }))} value={kind} onChange={setKind} />
      <Field label={pt('search_placeholder')} value={q} onChangeText={setQ} autoCapitalize="none" onSubmitEditing={() => void run()} />
      <Button label={pt('search')} compact loading={busy} disabled={q.trim().length === 0} onPress={() => void run()} />
      {error ? <AppText tone="danger">{error}</AppText> : null}
      {result ? (
        result.results.length === 0 ? (
          <AppText tone="muted">{pt('no_results')}</AppText>
        ) : (
          <View style={{ gap: 6 }}>
            {result.results.map((b) => (
              <Card key={b.id} onPress={() => onOpen(b.id)}>
                <AppText variant="bodyStrong">{b.name}</AppText>
                <AppText variant="small" tone="muted">
                  {b.slug} · {b.accessStatus} · {b.id}
                </AppText>
              </Card>
            ))}
            {result.truncated ? <AppText variant="small" tone="muted">{pt('truncated')}</AppText> : null}
          </View>
        )
      ) : null}
    </Card>
  );
}
