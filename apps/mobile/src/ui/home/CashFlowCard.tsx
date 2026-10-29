import { Ionicons } from '@expo/vector-icons';
import { formatMoney, type Currency } from '@xiro/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { afterCloseNote, flowShares, unbilledNote, type DailyCashFlow } from '@/lib/cashFlow';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { radius } from '../theme';
import { GradientCard } from './GradientCard';
import { Skeleton } from './Skeleton';

/**
 * "Flujo de caja diario" del Inicio en Android/iOS (en la web: CashFlowCard de web/screens/Dashboard.tsx, mismas cuentas
 * de lib/cashFlow.ts). Neto del día, entradas (verde) frente a gastos (rojo) con su barra, lo cobrado por método y, con la
 * caja abierta, el efectivo que debería haber frente a la base inicial.
 */
export function CashFlowCard({
  flow,
  loading,
  error,
  currency,
  onSeeClose,
  onOpenCash,
}: {
  flow: DailyCashFlow | null;
  loading: boolean;
  error?: string;
  currency: Currency;
  onSeeClose: () => void;
  onOpenCash: () => void;
}) {
  const { colors, t } = useSettings();
  const money = (amount: number) => formatMoney(amount, currency);
  const shares = flow ? flowShares(flow) : { income: 0, expenses: 0 };
  const netColor = !flow || flow.net === 0 ? colors.text : flow.net > 0 ? colors.success : colors.danger;

  return (
    <GradientCard innerStyle={styles.card}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: colors.goldTint }]}>
          <Ionicons name="wallet-outline" size={18} color={colors.gold} />
        </View>
        <View style={styles.flex}>
          <AppText variant="heading" accessibilityRole="header">
            {t('home_cf_title')}
          </AppText>
          <AppText variant="small" tone="muted">
            {t('home_cf_sub')}
          </AppText>
        </View>
        <Pressable accessibilityRole="button" onPress={onSeeClose} hitSlop={10} style={styles.headAction}>
          <AppText tone="gold" variant="bodyStrong">
            {t('home_cf_see_close')} ›
          </AppText>
        </Pressable>
      </View>

      {loading ? <Skeleton width={170} height={34} style={{ marginVertical: 6 }} /> : null}
      {!loading && error ? <AppText tone="muted">{error}</AppText> : null}

      {!loading && flow ? (
        <>
          <View accessible accessibilityLabel={`${t('home_cf_net')}: ${money(flow.net)}`}>
            <AppText variant="label" tone="muted">
              {t('home_cf_net').toUpperCase()}
            </AppText>
            <AppText variant="display" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: netColor }}>
              {money(flow.net)}
            </AppText>
          </View>

          <View style={styles.flows}>
            {(
              [
                { id: 'in', label: t('home_cf_in'), value: flow.income, color: colors.success, icon: 'trending-up' },
                { id: 'out', label: t('home_cf_out'), value: flow.expenses, color: colors.danger, icon: 'trending-down' },
              ] as const
            ).map((f) => (
              <View key={f.id} accessible accessibilityLabel={`${f.label}: ${money(f.value)}`} style={[styles.flow, { borderColor: `${f.color}55`, backgroundColor: `${f.color}14` }]}>
                <View style={[styles.flowIcon, { backgroundColor: `${f.color}26` }]}>
                  <Ionicons name={f.icon} size={16} color={f.color} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="small" tone="muted">
                    {f.label}
                  </AppText>
                  <AppText variant="bodyStrong" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color: f.color }}>
                    {money(f.value)}
                  </AppText>
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.bar, { backgroundColor: colors.surfaceAlt }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {shares.income > 0 ? <View style={[styles.barPart, { flex: shares.income, backgroundColor: colors.success }]} /> : null}
            {shares.expenses > 0 ? <View style={[styles.barPart, { flex: shares.expenses, backgroundColor: colors.danger }]} /> : null}
          </View>

          {flow.income === 0 && flow.expenses === 0 ? (
            <AppText variant="small" tone="muted">
              {t('home_cf_empty')}
            </AppText>
          ) : null}
          {flow.tips > 0 ? (
            <AppText variant="small" tone="muted">
              {t('home_cf_tips', { amount: money(flow.tips) })}
            </AppText>
          ) : null}
          {unbilledNote(flow.unbilled, money, t) ? (
            <AppText variant="small" tone="muted">
              {unbilledNote(flow.unbilled, money, t)}
            </AppText>
          ) : null}
          {flow.methods.length > 0 ? (
            <View style={styles.methods} accessibilityLabel={t('home_cf_by_method')}>
              {flow.methods.map((m) => (
                <View key={m.method} style={[styles.method, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
                  <AppText variant="small" tone="muted">
                    {t(`sale_pay_${m.method}`)}{' '}
                    <AppText variant="small" style={{ fontWeight: '700' }}>
                      {money(m.total)}
                    </AppText>
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          <View style={[styles.cash, { borderColor: `${colors.gold}66`, backgroundColor: colors.goldTint }]}>
            {flow.cash.state === 'open' ? (
              <View accessible accessibilityLabel={`${t('home_cf_cash_now')}: ${money(flow.cash.current)}. ${t('home_cf_base')}: ${money(flow.cash.opening)}`}>
                <AppText variant="label" tone="muted">
                  {t('home_cf_cash_now').toUpperCase()}
                </AppText>
                <AppText variant="title" tone="gold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {money(flow.cash.current)}
                </AppText>
                <AppText variant="small" style={{ color: flow.cash.current > flow.cash.opening ? colors.success : flow.cash.current < flow.cash.opening ? colors.danger : colors.textMuted }}>
                  {t('home_cf_since_open', { amount: `${flow.cash.current > flow.cash.opening ? '+' : ''}${money(flow.cash.current - flow.cash.opening)}` })}
                </AppText>
                <View style={[styles.baseRow, { borderTopColor: colors.border }]}>
                  <AppText variant="small" tone="muted">
                    {t('home_cf_base')}
                  </AppText>
                  <AppText variant="small" style={{ fontWeight: '700' }}>
                    {money(flow.cash.opening)}
                  </AppText>
                </View>
              </View>
            ) : flow.cash.state === 'closed' ? (
              <View style={styles.row}>
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" tone="muted">
                    {t('home_cf_closed')}
                  </AppText>
                  {afterCloseNote(flow.afterClose, money, t) ? (
                    <AppText variant="small" tone="muted">
                      {afterCloseNote(flow.afterClose, money, t)}
                    </AppText>
                  ) : null}
                </View>
              </View>
            ) : (
              <View style={styles.row}>
                <AppText variant="small" tone="muted" style={styles.flex}>
                  {t('home_cf_not_opened')}
                </AppText>
                <Pressable accessibilityRole="button" onPress={onOpenCash} hitSlop={8} style={[styles.openBtn, { borderColor: colors.gold }]}>
                  <AppText variant="small" tone="gold" style={{ fontWeight: '700' }}>
                    {t('home_cf_open_cash')}
                  </AppText>
                </Pressable>
              </View>
            )}
          </View>
        </>
      ) : null}
    </GradientCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headAction: { minHeight: 44, justifyContent: 'center' },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  flows: { flexDirection: 'row', gap: 10 },
  flow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8 },
  flowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', gap: 3, height: 8, borderRadius: 4, overflow: 'hidden' },
  barPart: { borderRadius: 4 },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  method: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  cash: { borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, padding: 12 },
  baseRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  openBtn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
});
