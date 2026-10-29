import { StyleSheet, View } from 'react-native';
import type { BreakdownLineView, BreakdownView } from '@/lib/cashBreakdown';
import type { CashDetailTarget } from '@/lib/useCashDetail';
import { Button } from '@/ui/Button';
import { AnimatedShareBar } from '@/ui/AnimatedCharts';
import { Card, SectionTitle } from '@/ui/Kit';
import { AppText } from '@/ui/Text';
import { space } from '@/ui/theme';

type T = (key: string, params?: Record<string, string | number>) => string;

/** Fila "Etiqueta …… valor" accesible como un solo texto para el lector de pantalla. */
function Amount({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'muted' | 'gold' }) {
  return (
    <View style={styles.amountRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText tone={tone ?? 'muted'} variant={strong ? 'bodyStrong' : 'small'}>
        {label}
      </AppText>
      <AppText variant={strong ? 'bodyStrong' : 'small'} tone={strong ? 'gold' : 'text'}>
        {value}
      </AppText>
    </View>
  );
}

function Lines({ title, lines }: { title: string; lines: BreakdownLineView[] }) {
  if (lines.length === 0) return null;
  return (
    <View style={{ marginTop: space.sm }}>
      <AppText variant="small" tone="muted" style={{ marginBottom: space.xs }}>
        {title}
      </AppText>
      {lines.map((line) => (
        <View key={line.key} style={styles.line} accessible accessibilityLabel={`${line.label}. ${line.detail}. ${line.net}`}>
          <View style={{ flex: 1 }}>
            <AppText variant="small">{line.label}</AppText>
            <AppText variant="small" tone="muted">
              {line.detail}
            </AppText>
          </View>
          <AppText variant="small">{line.net}</AppText>
        </View>
      ))}
    </View>
  );
}

/** Cierre de caja (Android/iOS): producción por empleado con bruto, descuento, neto y servicios; productos y propinas aparte. */
export function CashBreakdownSection({ t, view, onSeeMore }: { t: T; view: BreakdownView; onSeeMore?: (target: CashDetailTarget) => void }) {
  return (
    <>
      <SectionTitle>{t('cash_close_breakdown_title')}</SectionTitle>
      <AppText variant="small" tone="muted" style={{ marginBottom: space.sm }}>
        {t('cash_close_breakdown_intro')}
      </AppText>
      {view.empty ? (
        <AppText tone="muted" variant="small" style={{ marginBottom: space.md }}>
          {t('cash_close_breakdown_empty')}
        </AppText>
      ) : null}
      {view.employees.map((e, index) => (
        <Card key={e.id} style={{ marginBottom: space.sm }}>
          <View style={styles.head}>
            <AppText variant="bodyStrong" style={{ flex: 1 }}>
              {e.name}
            </AppText>
            <AppText variant="small" tone="muted">
              {e.units}
            </AppText>
          </View>
          <AnimatedShareBar share={e.share} delay={index * 90} />
          <Amount label={t('cash_close_breakdown_gross')} value={e.gross} />
          <Amount label={t('cash_close_breakdown_discount')} value={e.discount} />
          <Amount label={t('cash_close_breakdown_net')} value={e.net} strong tone="gold" />
          <Lines title={t('cash_close_breakdown_services')} lines={e.lines} />
          {onSeeMore ? (
            <Button label={t('cash_detail_see_more')} accessibilityLabel={t('cash_detail_see_more_employee', { name: e.name })} variant="secondary" compact onPress={() => onSeeMore({ scope: 'employee', employeeId: e.id, name: e.name })} style={{ marginTop: space.sm }} />
          ) : null}
        </Card>
      ))}
      {view.unattributed ? (
        <Card style={{ marginBottom: space.sm }}>
          <AppText variant="bodyStrong" style={{ marginBottom: space.xs }}>
            {t('cash_close_breakdown_unattributed')}
          </AppText>
          <Amount label={t('cash_close_breakdown_gross')} value={view.unattributed.gross} />
          <Amount label={t('cash_close_breakdown_discount')} value={view.unattributed.discount} />
          <Amount label={t('cash_close_breakdown_net')} value={view.unattributed.net} strong tone="gold" />
          <Lines title={t('cash_close_breakdown_unattributed_services')} lines={view.unattributed.services} />
          <Lines title={t('cash_close_breakdown_products')} lines={view.unattributed.products} />
          {view.unattributed.products.length > 0 ? (
            <AppText variant="small" tone="muted" style={{ marginTop: space.xs }}>
              {t('cash_close_breakdown_products_note')}
            </AppText>
          ) : null}
          {onSeeMore ? <Button label={t('cash_detail_see_more')} variant="secondary" compact accessibilityLabel={t('cash_detail_see_more_unattributed')} onPress={() => onSeeMore({ scope: 'unattributed' })} style={{ marginTop: space.sm }} /> : null}
        </Card>
      ) : null}
      {!view.empty ? (
        <Card style={{ marginBottom: space.md }}>
          <Amount label={t('cash_close_breakdown_tips')} value={view.tips} />
          {view.hasTips ? (
            <AppText variant="small" tone="muted">
              {t('cash_close_breakdown_tips_note')}
            </AppText>
          ) : null}
          <AppText variant="small" tone="text" style={{ marginTop: space.xs }}>
            {view.reconcile}
          </AppText>
          <AppText variant="small" tone="muted" style={{ marginTop: space.xs }}>
            {t('cash_close_breakdown_discount_rule')}
          </AppText>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xs, gap: space.sm },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.xs },
});
