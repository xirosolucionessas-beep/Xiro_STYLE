import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@xiro/shared';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { actorOf, meets, type Requirement } from '@/lib/access';
import { useCashToday } from '@/lib/queries';
import { useAuthed } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useDialogs } from '@/ui/Dialogs';
import { Brand } from '@/ui/Brand';
import { Card } from '@/ui/Kit';
import { Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';
import { radius } from '@/ui/theme';

let cashPromptShown = false;

type IconName = keyof typeof Ionicons.glyphMap;

export default function Home() {
  const router = useRouter();
  const { colors, t } = useSettings();
  const { user, business } = useAuthed();
  const { toast } = useDialogs();
  const isOwner = user.role === 'owner';
  const cash = useCashToday(isOwner);
  const { width } = useWindowDimensions();
  const columns = width >= 600 ? 3 : 2;

  useEffect(() => {
    if (isOwner && cash.isSuccess && !cash.data.opening && !cashPromptShown) {
      cashPromptShown = true;
      router.push('/cash-opening');
    }
  }, [isOwner, cash.isSuccess, cash.data, router]);

  const soon = () => toast(`${t('coming_soon')} · ${t('coming_soon_body')}`);
  const actor = actorOf(user);
  const allActions: Array<{ icon: IconName; label: string; onPress: () => void; requires?: Requirement }> = [
    { icon: 'add-circle-outline', label: t('new_service'), onPress: () => router.push('/item/form'), requires: ['catalog_manage'] },
    { icon: 'calendar-outline', label: t('appointments'), onPress: soon, requires: 'owner' },
    { icon: 'book-outline', label: t('catalog'), onPress: () => router.navigate('/catalog'), requires: ['catalog_view'] },
    { icon: 'cube-outline', label: t('inventory'), onPress: () => router.navigate('/inventory'), requires: ['catalog_view'] },
    { icon: 'cash-outline', label: t('cash_close'), onPress: soon, requires: 'owner' },
    { icon: 'people-outline', label: t('clients'), onPress: () => router.navigate('/clients'), requires: ['clients_view'] },
  ];
  const actions = allActions.filter((action) => meets(actor, action.requires));

  const opening = cash.data?.opening;
  const needsSetup = isOwner && !business.whatsapp;

  return (
    <Screen refreshing={cash.isRefetching} onRefresh={() => void cash.refetch()}>
      <View style={styles.top}>
        <Brand size={54} logoUrl={business.logoUrl} />
        <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.owner}>
          <View style={styles.ownerText}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {user.name}
            </AppText>
            <AppText variant="small" tone="muted" numberOfLines={1}>
              {t('account')} · {business.name}
            </AppText>
          </View>
          <View style={[styles.avatar, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
            <AppText variant="heading" tone="gold">
              {user.name.trim().charAt(0).toUpperCase()}
            </AppText>
          </View>
        </Pressable>
      </View>

      <AppText tone="muted" variant="small" style={styles.today}>
        {t('today')}
      </AppText>

      {isOwner ? (
      <Pressable accessibilityRole="button" onPress={() => router.push('/cash-opening')} style={[styles.balance, { backgroundColor: colors.surfaceAlt, borderColor: colors.gold }]}>
        <View style={[styles.wallet, { backgroundColor: colors.goldTint }]}>
          <Ionicons name="wallet-outline" size={26} color={colors.gold} />
        </View>
        <View style={styles.flex}>
          <AppText tone="muted" variant="small">
            {t('available_balance')}
          </AppText>
          <AppText variant="display">{opening ? formatMoney(opening.amount, business.currency) : '—'}</AppText>
          {!opening && cash.isSuccess ? (
            <AppText variant="small" tone="gold">
              {t('cash_not_opened')}
            </AppText>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.gold} />
      </Pressable>
      ) : null}

      {needsSetup ? (
        <Card onPress={() => router.push('/business')} style={styles.setup}>
          <Ionicons name="storefront-outline" size={22} color={colors.gold} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">{t('business_settings')}</AppText>
            <AppText variant="small" tone="muted">
              {t('business_whatsapp')}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Card>
      ) : null}

      <View style={styles.grid}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            onPress={action.onPress}
            style={({ pressed }) => [
              styles.tile,
              { width: `${100 / columns - 2.5}%`, backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
            ]}>
            <View style={[styles.tileIcon, { backgroundColor: colors.goldTint }]}>
              <Ionicons name={action.icon} size={24} color={colors.gold} />
            </View>
            <AppText variant="bodyStrong" style={styles.tileLabel}>
              {action.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14 },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  ownerText: { alignItems: 'flex-end', flexShrink: 1 },
  avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  today: { marginTop: 18, marginBottom: 10 },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: radius.xl, borderWidth: 1, padding: 18 },
  wallet: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  setup: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18, justifyContent: 'space-between' },
  tile: { minHeight: 132, borderRadius: radius.lg, borderWidth: 1, padding: 15, justifyContent: 'space-between' },
  tileIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { marginTop: 14 },
});
