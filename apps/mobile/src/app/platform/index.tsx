import { useQuery } from '@tanstack/react-query';
import { formatMoney, PLATFORM_SEARCH_KINDS, type Currency, type HealthCheck, type PlatformGrouping, type PlatformOverview, type PlatformSearchKind, type PlatformSearchResult, type PlatformSeries } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { hasPermission, platformApi, usePlatformSession } from '@/lib/platformApi';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Card, Photo } from '@/ui/Kit';
import { AccessBadge, Badge, BarChart, formatDateTime, formatNumber, formatTime, IndicatorMeta, KV, Segmented, Stat, styles, Titled, type Tone } from '@/ui/platform/parts';
import { errorText, hasText, usePlatformText, type PlatformText } from '@/ui/platform/strings';
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
    <Screen center header={<Header root title={pt('login_title')} subtitle={pt('login_hint')} />}>
      <Card style={loginStyles.card}>
        <Field label={pt('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="username" />
        <Field label={pt('password')} value={password} onChangeText={setPassword} password autoComplete="current-password" />
        <Field label={pt('totp')} value={totp} onChangeText={setTotp} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
        {error ? (
          <AppText tone="danger" accessibilityRole="alert">
            {error}
          </AppText>
        ) : null}
        <Button label={pt('sign_in')} loading={busy} disabled={!email || !password || !/^(\d{6})?$/.test(totp.trim())} onPress={() => void submit()} />
        <AppText variant="small" tone="muted">
          {pt('session_memory')}
        </AppText>
      </Card>
    </Screen>
  );
}

/** Solo presentación: la tarjeta queda centrada y acotada a ~420px (`Screen center`), con un realce discreto. Campos,
 * validaciones, mensajes, TOTP y flujo de autenticación arriba no cambiaron. */
const loginStyles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 420,
    gap: 14,
    paddingVertical: 22,
    ...Platform.select({
      web: { boxShadow: '0 14px 36px rgba(0,0,0,0.3)' } as object,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 18, elevation: 5 },
    }),
  },
});

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
  const tz = localTz();
  // "Hasta hoy" en la zona elegida lo calcula el servidor; aquí solo el inicio (aprox. por días UTC, ambos extremos incluidos).
  const from = isoDay(new Date(Date.now() - (PERIODS[period] - 1) * 86_400_000));
  const canMetrics = hasPermission(admin, 'metrics_view');

  // Refresco moderado (60 s) y sin reintentos en bucle: el panel nunca debe cargar la base que usan los negocios.
  const overview = useQuery({ queryKey: ['platform', 'overview', from, tz], queryFn: () => platformApi.overview({ from, tz }), enabled: canMetrics, refetchInterval: 60_000, staleTime: 30_000, retry: 1 });
  const o = overview.data;

  return (
    <Screen
      header={
        <Header
          root
          title={pt('title')}
          subtitle={admin ? `${admin.name} · ${admin.isFounder ? pt('role_founder') : pt('role_admin')}` : pt('subtitle')}
          right={<Button label={pt('sign_out')} variant="ghost" compact onPress={() => void platformApi.logout()} />}
        />
      }>
      <View style={{ gap: 16 }}>
        {admin?.isFounder || hasPermission(admin, 'audit_view') ? (
          <View style={styles.row} accessibilityLabel={pt('quick_actions')}>
            {admin?.isFounder ? <Button label={pt('create_business')} icon="add-circle-outline" compact onPress={() => router.push('/platform/new')} /> : null}
            {hasPermission(admin, 'audit_view') ? <Button label={pt('audit_title')} icon="document-text-outline" variant="secondary" compact onPress={() => router.push('/platform/audit')} /> : null}
            {hasPermission(admin, 'audit_view') ? <Button label={pt('deleted_businesses_title')} icon="trash-outline" variant="secondary" compact onPress={() => router.push('/platform/businesses-deleted')} /> : null}
          </View>
        ) : null}

        {hasPermission(admin, 'businesses_view') ? <Search pt={pt} language={language} onOpen={(id) => router.push(`/platform/business/${id}`)} /> : null}

        {!canMetrics ? null : (
          <View style={{ gap: 12 }}>
            <Titled title={pt('overview')} help={pt('overview_help')} pt={pt} variant="title" />
            <Segmented label={pt('period')} options={(Object.keys(PERIODS) as Array<keyof typeof PERIODS>).map((k) => ({ value: k, label: pt(k) }))} value={period} onChange={setPeriod} />
            <View style={styles.row}>
              <AppText variant="small" tone="muted" style={styles.flexShrink}>
                {pt('period_note')} ({tz}).{o ? ` ${pt('updated_at')}: ${formatTime(o.generatedAt, language)}.` : ''}
              </AppText>
              <Button label={pt('refresh')} icon="refresh" variant="ghost" compact loading={overview.isFetching} onPress={() => void overview.refetch()} />
            </View>
            {overview.isLoading ? <AppText tone="muted">{pt('loading')}</AppText> : null}
            {overview.error ? (
              <AppText tone="danger" accessibilityRole="alert">
                {errorText(pt, overview.error instanceof ApiError ? overview.error.code : undefined)}
              </AppText>
            ) : null}
            {o ? <Overview o={o} from={from} tz={tz} pt={pt} language={language} onViewBusinesses={() => router.push('/platform/businesses')} /> : null}
          </View>
        )}
      </View>
    </Screen>
  );
}

function Overview({ o, from, tz, pt, language, onViewBusinesses }: { o: PlatformOverview; from: string; tz: string; pt: PlatformText; language: string; onViewBusinesses: () => void }) {
  const num = (n: number) => formatNumber(n, language);
  const accessHelp = [pt('access_help'), ...(['active', 'suspended', 'deactivated'] as const).map((k) => `${pt(`status_${k}_one`)}: ${pt(`status_${k}_help`)}`)].join('\n');
  const SUBS = ['trial', 'active', 'past_due', 'expired', 'canceled', 'none'] as const;
  const subsHelp = [pt('subs_help'), ...SUBS.map((k) => `${pt(`sub_${k}`)}: ${pt(`sub_${k}_help`)}`)].join('\n');

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 10 }}>
        <AppText variant="heading" accessibilityRole="header">
          {pt('section_businesses')}
        </AppText>
        <View style={styles.grid}>
          <Stat
            label={pt('businesses_total')}
            help={pt('businesses_total_help')}
            indicator={o.businesses.total}
            pt={pt}
            language={language}
            action={<Button label={pt('view_more')} variant="ghost" compact onPress={onViewBusinesses} />}
          />
          <Stat label={pt('businesses_new')} help={pt('businesses_new_help')} indicator={o.businesses.newInPeriod} pt={pt} language={language} />
          <Stat
            label={pt('access')}
            help={accessHelp}
            indicator={o.businesses.byAccessStatus}
            pt={pt}
            language={language}
            render={() => (
              <View>
                {(['active', 'suspended', 'deactivated'] as const).map((k) => (
                  <KV key={k} label={pt(`status_${k}`)} right={<View style={styles.row}><AccessBadge status={k} pt={pt} /><AppText variant="bodyStrong">{num(o.businesses.byAccessStatus.value![k])}</AppText></View>} />
                ))}
              </View>
            )}
          />
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <AppText variant="heading" accessibilityRole="header">
          {pt('section_subscriptions')}
        </AppText>
        <View style={styles.grid}>
          <Stat
            wide
            label={pt('subs_title')}
            help={subsHelp}
            indicator={o.subscriptions.byStatus}
            pt={pt}
            language={language}
            render={() => (
              <View>
                {SUBS.map((k) => (
                  <KV key={k} label={pt(`sub_${k}`)} value={num(o.subscriptions.byStatus.value![k])} />
                ))}
                <KV label={pt('sub_with_access')} value={num(o.subscriptions.byStatus.value!.withAccess)} strong />
              </View>
            )}
          />
          <Stat label={pt('renewing_7')} help={pt('renewing_7_help')} indicator={o.subscriptions.renewingNext7Days} pt={pt} language={language} />
          <Stat label={pt('cancelling')} help={pt('cancelling_help')} indicator={o.subscriptions.cancelAtPeriodEnd} pt={pt} language={language} />
          <Stat label={pt('active_grants')} help={pt('active_grants_help')} indicator={o.subscriptions.activeAccessGrants} pt={pt} language={language} />
          <Stat
            label={pt('payments')}
            help={pt('payments_help')}
            indicator={o.subscriptions.paymentsInPeriod}
            pt={pt}
            language={language}
            render={() =>
              o.subscriptions.paymentsInPeriod.value!.length === 0 ? (
                <AppText>{pt('no_payments')}</AppText>
              ) : (
                <View>
                  {o.subscriptions.paymentsInPeriod.value!.map((p) => (
                    <KV key={p.currency} label={`${p.currency} · ${num(p.count)} ${pt('payments_count')}`} value={formatMoney(p.amount, p.currency as Currency)} strong />
                  ))}
                </View>
              )
            }
          />
        </View>
      </View>

      <History from={from} tz={tz} newInPeriod={o.businesses.newInPeriod.state === 'ok' ? o.businesses.newInPeriod.value : null} pt={pt} language={language} />

      <View style={{ gap: 10 }}>
        <Titled title={pt('section_technical')} help={pt('section_technical_help')} pt={pt} />
        <Card style={{ gap: 4 }}>
          <Titled title={pt('health')} help={pt('health_help')} pt={pt} variant="label" />
          {o.health.map((h) => (
            <HealthRow key={h.name} h={h} pt={pt} />
          ))}
        </Card>
        <View style={styles.grid}>
          <Stat
            label={pt('traffic')}
            help={pt('traffic_help')}
            indicator={o.traffic}
            pt={pt}
            language={language}
            render={() => {
              const v = o.traffic.value!;
              const ms = (x: number | null) => (x === null ? '—' : `< ${num(x)} ms`);
              return (
                <View>
                  <KV label={pt('requests')} value={num(v.requests)} strong />
                  <KV label={pt('errors_client')} value={num(v.errors4xx)} />
                  <AppText variant="small" tone="muted">
                    {pt('errors_client_help')}
                  </AppText>
                  <KV label={pt('errors_server')} right={<Badge label={num(v.errors5xx)} tone={v.errors5xx === 0 ? 'success' : 'danger'} icon={v.errors5xx === 0 ? 'checkmark-circle' : 'alert-circle'} />} />
                  <AppText variant="small" tone="muted">
                    {pt('errors_server_help')}
                  </AppText>
                  <Titled title={pt('latency')} help={pt('latency_help')} pt={pt} variant="label" />
                  <KV label={pt('latency_half')} value={ms(v.p50Ms)} />
                  <KV label={pt('latency_95')} value={ms(v.p95Ms)} />
                  <KV label={pt('latency_99')} value={ms(v.p99Ms)} />
                  <KV label={pt('since')} value={formatDateTime(v.since, language)} />
                </View>
              );
            }}
          />
          <Stat
            label={pt('pool')}
            help={pt('pool_help')}
            indicator={o.databasePool}
            pt={pt}
            language={language}
            render={() => {
              const v = o.databasePool.value!;
              return (
                <View>
                  <KV label={pt('pool_in_use')} value={num(v.total - v.idle)} strong />
                  <KV label={pt('pool_idle')} value={num(v.idle)} />
                  <KV label={pt('pool_waiting')} right={<Badge label={num(v.waiting)} tone={v.waiting === 0 ? 'success' : 'warning'} />} />
                </View>
              );
            }}
          />
        </View>
      </View>

      <Card style={{ gap: 10 }}>
        <Titled title={pt('unavailable_title')} help={pt('unavailable_help')} pt={pt} />
        {o.unavailable.map((u) => {
          const key = `unavailable_${u.key}`;
          const why = `${key}_why`;
          return (
            <View key={u.key} style={{ gap: 2 }}>
              <View style={styles.row}>
                <Badge label={pt('state_unavailable')} tone="neutral" icon="remove-circle-outline" />
                <AppText variant="bodyStrong" style={styles.flexShrink}>
                  {hasText(key) ? pt(key) : u.key}
                </AppText>
              </View>
              <AppText variant="small" tone="muted">
                {hasText(why) ? pt(why) : u.reason}
              </AppText>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const HEALTH_TONE: Record<HealthCheck['state'], { tone: Tone; icon: 'checkmark-circle' | 'alert-circle' | 'remove-circle-outline' | 'help-circle-outline' }> = {
  up: { tone: 'success', icon: 'checkmark-circle' },
  down: { tone: 'danger', icon: 'alert-circle' },
  not_configured: { tone: 'neutral', icon: 'remove-circle-outline' },
  unknown: { tone: 'warning', icon: 'help-circle-outline' },
};

function HealthRow({ h, pt }: { h: HealthCheck; pt: PlatformText }) {
  const base = h.name.split(':')[0]!; // "storage:local" / "storage:s3" -> storage
  const name = `service_${base}`;
  const help = `${name}_help`;
  return (
    <View style={{ paddingVertical: 6, gap: 2 }}>
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {hasText(name) ? pt(name) : h.name}
        </AppText>
        <Badge label={pt(`health_${h.state}`)} {...HEALTH_TONE[h.state]} />
      </View>
      <AppText variant="small" tone="muted">
        {hasText(help) ? pt(help) : h.detail}
        {h.latencyMs !== null && h.state === 'up' ? ` · ${pt('latency_ms')} ${h.latencyMs} ms` : ''}
      </AppText>
    </View>
  );
}

const SERIES: PlatformSeries[] = ['new_businesses', 'trials_started', 'payments', 'access_grants'];

function History({ from, tz, newInPeriod, pt, language }: { from: string; tz: string; newInPeriod: number | null; pt: PlatformText; language: string }) {
  const [series, setSeries] = useState<PlatformSeries>('new_businesses');
  const [grouping, setGrouping] = useState<PlatformGrouping>('day');
  const chart = useQuery({ queryKey: ['platform', 'series', series, grouping, from, tz], queryFn: () => platformApi.series(series, grouping, { from, tz }), staleTime: 60_000, retry: 1 });
  const total = chart.data?.buckets.reduce((s, b) => s + b.value, 0) ?? null;

  return (
    <Card style={{ gap: 10 }}>
      <Titled title={pt('chart_title')} help={pt('chart_help')} pt={pt} />
      <Segmented label={pt('chart_title')} options={SERIES.map((k) => ({ value: k, label: pt(`series_${k}`) }))} value={series} onChange={setSeries} />
      <AppText variant="small" tone="muted">
        {pt(`series_${series}_help`)}
      </AppText>
      <View style={styles.row}>
        <AppText variant="label" tone="muted">
          {pt('group_by')}
        </AppText>
        <Segmented label={pt('group_by')} options={(['day', 'week', 'month'] as const).map((k) => ({ value: k, label: pt(`group_${k}`) }))} value={grouping} onChange={setGrouping} />
      </View>
      {chart.isLoading ? <AppText tone="muted">{pt('loading')}</AppText> : null}
      {chart.error ? (
        <View style={styles.row}>
          <AppText tone="danger" accessibilityRole="alert" style={styles.flexShrink}>
            {errorText(pt, chart.error instanceof ApiError ? chart.error.code : undefined)}
          </AppText>
          <Button label={pt('refresh')} variant="ghost" compact onPress={() => void chart.refetch()} />
        </View>
      ) : null}
      {chart.data ? (
        <>
          <BarChart buckets={chart.data.buckets} grouping={grouping} language={language} pt={pt} unitLabel={pt(`series_${series}`).toLowerCase()} />
          {grouping !== 'day' ? (
            <AppText variant="small" tone="muted">
              {pt('chart_partial')}
            </AppText>
          ) : null}
          {series === 'new_businesses' && newInPeriod !== null && total === newInPeriod ? <Badge label={pt('chart_matches')} tone="success" icon="checkmark-circle" /> : null}
          <AppText variant="small" tone="muted">
            {pt('timezone')}: {chart.data.timezone}
          </AppText>
          <IndicatorMeta indicator={chart.data} pt={pt} language={language} />
        </>
      ) : null}
    </Card>
  );
}

function Search({ pt, language, onOpen }: { pt: PlatformText; language: string; onOpen: (id: string) => void }) {
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
      <Titled title={pt('search_title')} help={pt('search_help')} pt={pt} />
      <Segmented label={pt('search_title')} options={PLATFORM_SEARCH_KINDS.map((k) => ({ value: k, label: pt(`search_kind_${k}`) }))} value={kind} onChange={setKind} />
      <Field label={pt('search_placeholder')} value={q} onChangeText={setQ} autoCapitalize="none" keyboardType={kind === 'email' ? 'email-address' : 'default'} onSubmitEditing={() => void run()} />
      <Button label={pt('search')} icon="search" compact loading={busy} disabled={q.trim().length === 0} onPress={() => void run()} />
      {error ? (
        <AppText tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
      {result ? (
        result.results.length === 0 ? (
          <AppText tone="muted">{pt('no_results')}</AppText>
        ) : (
          <View style={{ gap: 6 }}>
            {result.results.map((b) => (
              <Card key={b.id} onPress={() => onOpen(b.id)}>
                <View style={[styles.row, { alignItems: 'flex-start' }]}>
                  <Photo url={b.logoUrl} size={44} initials={b.name} icon="storefront-outline" />
                  <View style={[styles.flex, { gap: 2 }]}>
                    <View style={styles.row}>
                      <AppText variant="bodyStrong" style={styles.flex}>
                        {b.name}
                      </AppText>
                      <AccessBadge status={b.accessStatus} pt={pt} />
                    </View>
                    <AppText variant="small" tone="muted">
                      {pt('search_kind_slug')}: {b.slug} · {pt('created')}: {formatDateTime(b.createdAt, language)}
                    </AppText>
                  </View>
                </View>
              </Card>
            ))}
            {result.truncated ? (
              <AppText variant="small" tone="muted">
                {pt('truncated')}
              </AppText>
            ) : null}
          </View>
        )
      ) : null}
    </Card>
  );
}
