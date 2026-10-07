import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { radius } from '../theme';
import { GradientCard } from './GradientCard';
import { Skeleton } from './Skeleton';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Tarjetas informativas del Inicio nativo (Resumen del día, Alertas de inventario, Actividad reciente). Son solo
 * presentación: todo llega ya calculado y formateado desde Inicio, con las mismas funciones que el tablero web
 * (`lib/dashboard.ts`), así que las cifras coinciden en las tres plataformas.
 */

function PanelHead({ icon, title, action }: { icon: IconName; title: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useSettings();
  return (
    <View style={styles.head}>
      <Ionicons name={icon} size={20} color={colors.gold} />
      <AppText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </AppText>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={10} style={styles.headAction}>
          <AppText tone="gold" variant="bodyStrong">
            {action.label} ›
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Panel({ children }: { children: ReactNode }) {
  const { colors } = useSettings();
  return <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>;
}

function LoadingRows() {
  return (
    <View style={{ gap: 10, paddingVertical: 6 }}>
      <Skeleton height={36} radius={12} />
      <Skeleton height={36} radius={12} />
    </View>
  );
}

/* ---------- Resumen del día ---------- */

export interface SummaryStat {
  id: string;
  label: string;
  value: string;
}

export interface CashBase {
  label: string;
  value: string;
  /** Aviso cuando aún no se abre la caja hoy. */
  note?: string;
  onPress: () => void;
}

export function DaySummaryCard({ title, revenueLabel, revenue, stats, note, loading, seeAll, cash }: { title: string; revenueLabel: string; revenue: string; stats: SummaryStat[]; note?: string; loading: boolean; seeAll?: { label: string; onPress: () => void }; cash?: CashBase }) {
  const { colors } = useSettings();
  return (
    <GradientCard innerStyle={styles.summary}>
      <PanelHead icon="stats-chart" title={title} action={seeAll} />
      {loading ? (
        <Skeleton width={160} height={34} style={{ marginVertical: 6 }} />
      ) : (
        <View accessible accessibilityLabel={`${revenueLabel}: ${revenue}`}>
          <AppText variant="small" tone="muted">
            {revenueLabel}
          </AppText>
          <AppText variant="display" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {revenue}
          </AppText>
        </View>
      )}

      <View style={styles.stats}>
        {stats.map((stat, index) => (
          <View key={stat.id} style={[styles.stat, index === 0 ? { paddingLeft: 0 } : { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth }]} accessible accessibilityLabel={`${stat.label}: ${stat.value}`}>
            {loading ? <Skeleton width={36} height={20} /> : <AppText variant="heading" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{stat.value}</AppText>}
            <AppText variant="small" tone="muted" numberOfLines={2}>
              {stat.label}
            </AppText>
          </View>
        ))}
      </View>

      {note && !loading ? (
        <AppText variant="small" tone="muted" numberOfLines={1}>
          {note}
        </AppText>
      ) : null}

      {cash ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${cash.label}: ${cash.value}${cash.note ? `. ${cash.note}` : ''}`}
          onPress={cash.onPress}
          style={[styles.cash, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <View style={[styles.cashIcon, { backgroundColor: colors.goldTint }]}>
            <Ionicons name="wallet-outline" size={20} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="small" tone="muted">
              {cash.label}
            </AppText>
            <AppText variant="bodyStrong">{cash.value}</AppText>
            {cash.note ? (
              <AppText variant="small" tone="gold">
                {cash.note}
              </AppText>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </GradientCard>
  );
}

/* ---------- Alertas de inventario ---------- */

export interface StockRowView {
  id: string;
  name: string;
  badge: string;
  out: boolean;
  onPress: () => void;
}

export function StockAlertsCard({ title, rows, loading, emptyText, seeAll }: { title: string; rows: StockRowView[]; loading: boolean; emptyText: string; seeAll: { label: string; onPress: () => void } }) {
  const { colors } = useSettings();
  return (
    <Panel>
      <PanelHead icon="cube-outline" title={title} action={rows.length > 0 ? seeAll : undefined} />
      {loading ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <View style={styles.allGood}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <AppText tone="success" variant="bodyStrong">
            {emptyText}
          </AppText>
        </View>
      ) : (
        rows.map((row, index) => (
          <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${row.name}: ${row.badge}`} onPress={row.onPress} style={[styles.row, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <AppText style={{ flex: 1 }} numberOfLines={1}>
              {row.name}
            </AppText>
            <View style={[styles.pill, { backgroundColor: row.out ? colors.danger : colors.surfaceAlt, borderColor: row.out ? colors.danger : colors.warning }]}>
              <AppText variant="small" style={{ fontWeight: '700', color: row.out ? '#ffffff' : colors.warning }}>
                {row.badge}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))
      )}
    </Panel>
  );
}

/* ---------- Actividad reciente ---------- */

export interface ActivityRow {
  id: string;
  icon: IconName;
  title: string;
  detail?: string;
  time: string;
  amount?: string;
}

export function ActivityCard({ title, rows, loading, emptyText }: { title: string; rows: ActivityRow[]; loading: boolean; emptyText: string }) {
  const { colors } = useSettings();
  return (
    <Panel>
      <PanelHead icon="pulse-outline" title={title} />
      {loading ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <AppText tone="muted" style={{ paddingVertical: 8 }}>
          {emptyText}
        </AppText>
      ) : (
        rows.map((row, index) => (
          <View
            key={row.id}
            style={[styles.row, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
            accessible
            accessibilityLabel={[row.title, row.detail, row.amount, row.time].filter(Boolean).join('. ')}>
            <View style={[styles.activityIcon, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name={row.icon} size={16} color={colors.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {row.title}
              </AppText>
              <AppText variant="small" tone="muted" numberOfLines={1}>
                {[row.detail, row.time].filter(Boolean).join(' · ')}
              </AppText>
            </View>
            {row.amount ? <AppText variant="bodyStrong">{row.amount}</AppText> : null}
          </View>
        ))
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  headAction: { minHeight: 44, justifyContent: 'center' },
  panel: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 12 },
  summary: { padding: 16, gap: 12 },
  stats: { flexDirection: 'row' },
  stat: { flex: 1, paddingHorizontal: 8, gap: 2 },
  cash: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.md, padding: 12 },
  cashIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  allGood: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  activityIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
