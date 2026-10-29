import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CashExpensesDetailModel, CashSalesDetailModel, DetailState } from '@/lib/useCashDetail';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';
import { Card, EmptyState } from './Kit';
import { AppText } from './Text';
import { space } from './theme';

type T = (key: string, params?: Record<string, string | number>) => string;

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant={strong ? 'bodyStrong' : 'small'} tone={strong ? 'text' : 'muted'} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant={strong ? 'bodyStrong' : 'small'} tone={strong ? 'gold' : 'text'}>
        {value}
      </AppText>
    </View>
  );
}

function Sheet({ open, onClose, title, t, children }: { open: boolean; onClose: () => void; title: string; t: T; children: ReactNode }) {
  const { colors } = useSettings();
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <AppText variant="bodyStrong" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </AppText>
          <Button label={t('close')} variant="ghost" compact onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Body({ t, state, onRetry, emptyText, children }: { t: T; state: DetailState; onRetry: () => void; emptyText: string; children: ReactNode }) {
  const { colors } = useSettings();
  if (state === 'loading') return <ActivityIndicator color={colors.gold} style={{ marginTop: 24 }} accessibilityLabel={t('cash_detail_loading')} />;
  if (state === 'error')
    return (
      <View style={{ gap: space.sm }}>
        <AppText tone="danger">{t('cash_detail_error')}</AppText>
        <Button label={t('retry')} variant="secondary" onPress={onRetry} />
      </View>
    );
  if (state === 'empty') return <EmptyState icon="receipt-outline" message={emptyText} />;
  return <>{children}</>;
}

function Freshness({ t, updated, refreshError, onRetry }: { t: T; updated: string | null; refreshError: boolean; onRetry: () => void }) {
  if (!updated && !refreshError) return null;
  return (
    <View style={styles.fresh} accessibilityLiveRegion="polite">
      <AppText variant="small" tone={refreshError ? 'danger' : 'muted'} style={{ flex: 1 }}>
        {refreshError ? t('cash_close_live_error', { time: updated ?? '—' }) : t('cash_detail_updated', { time: updated ?? '—' })}
      </AppText>
      {refreshError ? <Button label={t('retry')} variant="secondary" compact onPress={onRetry} /> : null}
    </View>
  );
}

function More({ t, showing, hasMore, loadingMore, onMore }: { t: T; showing: string | null; hasMore: boolean; loadingMore: boolean; onMore: () => void }) {
  return (
    <>
      {showing ? (
        <AppText variant="small" tone="muted">
          {showing}
        </AppText>
      ) : null}
      {hasMore ? <Button label={t('cash_detail_load_more')} variant="secondary" loading={loadingMore} onPress={onMore} /> : null}
    </>
  );
}

/** "Ver más" de ventas (Android/iOS): ventas del día de un empleado o sin atribución. */
export function CashSalesDetailSheet(props: { open: boolean; onClose: () => void; t: T; title: string; note?: string | null; aggregate?: { gross: string; discount: string; net: string } | null; updated: string | null; model: CashSalesDetailModel }) {
  const { t, model } = props;
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.title} t={t}>
      {props.note ? (
        <AppText variant="small" tone="muted">
          {props.note}
        </AppText>
      ) : null}
      {props.aggregate ? (
        <Card>
          <Line label={t('cash_close_breakdown_gross')} value={props.aggregate.gross} />
          <Line label={t('cash_detail_discount_distributed')} value={props.aggregate.discount} />
          <Line label={t('cash_close_breakdown_net')} value={props.aggregate.net} strong />
        </Card>
      ) : null}
      {model.summary ? (
        <AppText variant="small" tone="muted">
          {model.summary}
        </AppText>
      ) : null}
      <Freshness t={t} updated={props.updated} refreshError={model.refreshError} onRetry={model.retry} />
      <Body t={t} state={model.state} onRetry={model.retry} emptyText={t('cash_detail_empty')}>
        {model.rows.map((row) => (
          <Card key={row.id} style={row.voided ? { opacity: 0.75 } : undefined}>
            <AppText variant="bodyStrong">{row.when}</AppText>
            {row.voided ? (
              <AppText variant="small" tone="danger">
                {t('cash_detail_voided')}
              </AppText>
            ) : null}
            <AppText variant="small" tone="muted">
              {row.client}
            </AppText>
            <AppText variant="small" tone="muted">
              {row.registeredBy}
            </AppText>
            {row.voidReason ? (
              <AppText variant="small" tone="muted">
                {row.voidReason}
              </AppText>
            ) : null}
            <AppText variant="small" tone="muted" style={{ marginTop: space.xs }}>
              {t('cash_detail_lines_title')}
            </AppText>
            {row.lines.map((line) => (
              <View key={line.key} style={{ marginBottom: space.xs }}>
                <Line label={line.label} value={line.net} />
                <AppText variant="small" tone="muted">
                  {t('cash_close_breakdown_gross')} {line.gross} · {t('cash_detail_discount_distributed')} {line.discount}
                </AppText>
              </View>
            ))}
            {row.otherLines.length > 0 ? (
              <>
                <AppText variant="small" tone="muted" style={{ marginTop: space.xs }}>
                  {t('cash_detail_other_lines')}
                </AppText>
                {row.otherLines.map((line) => (
                  <AppText key={line.key} variant="small" tone="muted">
                    {line.label}
                    {line.performer ? ` · ${line.performer}` : ''}
                  </AppText>
                ))}
              </>
            ) : null}
            <View style={{ marginTop: space.sm }}>
              <Line label={t('cash_detail_subtotal')} value={row.sale.subtotal} />
              <Line label={t('cash_detail_sale_discount')} value={row.sale.discount} />
              {row.sale.tip ? <Line label={t('cash_detail_tip')} value={row.sale.tip} /> : null}
              <Line label={t('cash_detail_total')} value={row.sale.total} strong />
              {row.sale.payments.map((p) => (
                <Line key={p.key} label={`${t('cash_detail_payments')} · ${p.label}`} value={p.amount} />
              ))}
              {row.sale.change ? <Line label={t('cash_detail_change')} value={row.sale.change} /> : null}
            </View>
          </Card>
        ))}
        <AppText variant="small" tone="muted">
          {t('cash_detail_distributed_note')}
        </AppText>
        <More t={t} showing={model.showing} hasMore={model.hasMore} loadingMore={model.loadingMore} onMore={model.loadMore} />
      </Body>
    </Sheet>
  );
}

/** "Ver más" de gastos (Android/iOS): agrupados por empleado beneficiario, con anulados y ajustes posteriores al cierre. */
export function CashExpensesDetailSheet(props: { open: boolean; onClose: () => void; t: T; title: string; updated: string | null; model: CashExpensesDetailModel }) {
  const { t, model } = props;
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.title} t={t}>
      {model.summary ? (
        <AppText variant="small" tone="muted">
          {model.summary}
        </AppText>
      ) : null}
      <Freshness t={t} updated={props.updated} refreshError={model.refreshError} onRetry={model.retry} />
      <Body t={t} state={model.state} onRetry={model.retry} emptyText={t('cash_exp_empty')}>
        {model.groups.map((group) => (
          <View key={group.key} style={{ gap: space.sm }}>
            <AppText variant="bodyStrong" accessibilityRole="header">
              {group.title}
            </AppText>
            {group.items.map((e) => (
              <Card key={e.id} style={e.voided ? { opacity: 0.75 } : undefined}>
                <Line label={e.title} value={e.amount} strong />
                {e.voided ? (
                  <AppText variant="small" tone="danger">
                    {t('cash_exp_voided')}
                  </AppText>
                ) : null}
                {[`${e.meta} · ${e.method}`, e.expenseDate, e.registered, e.beneficiary, e.fromCash, e.notes, e.voidInfo]
                  .filter((text): text is string => Boolean(text))
                  .map((text) => (
                    <AppText key={text} variant="small" tone="muted">
                      {text}
                    </AppText>
                  ))}
              </Card>
            ))}
          </View>
        ))}
        <More t={t} showing={model.showing} hasMore={model.hasMore} loadingMore={model.loadingMore} onMore={model.loadMore} />
      </Body>
      {model.adjustments.length > 0 ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="bodyStrong" accessibilityRole="header">
            {t('cash_exp_adjustments')}
          </AppText>
          {model.adjustments.map((text, index) => (
            <AppText key={index} variant="small" tone="muted">
              {text}
            </AppText>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { padding: space.md, gap: space.md, paddingBottom: 48 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, marginBottom: 2 },
  fresh: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
