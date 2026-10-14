import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from '../Text';
import { radius } from '../theme';

export type ReportsTab = 'sales' | 'balance';

/**
 * Pestañas de Reportes (Android, iOS y web): "Ventas" (/reports, solo el dueño) y "Balance general" (/reports/balance, dueño
 * o "Finanzas"). Un empleado con "Finanzas" solo ve la del balance: la de ventas no se le ofrece.
 */
export function ReportsTabs({ active, showSales }: { active: ReportsTab; showSales: boolean }) {
  const { colors, t } = useSettings();
  const router = useRouter();
  const tabs: Array<{ id: ReportsTab; label: string; href: '/reports' | '/reports/balance' }> = [
    ...(showSales ? [{ id: 'sales' as const, label: t('rep_tab_sales'), href: '/reports' as const }] : []),
    { id: 'balance', label: t('rep_tab_balance'), href: '/reports/balance' },
  ];
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => (selected ? undefined : router.replace(tab.href))}
            style={[styles.tab, selected && { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
            <AppText variant="bodyStrong" tone={selected ? 'gold' : 'muted'}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignSelf: 'flex-start', gap: 4, padding: 4, borderWidth: 1, borderRadius: radius.lg, marginBottom: 12 },
  tab: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
});
