import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';
import { MAX_CONTENT_WIDTH, radius } from './theme';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  /** Contenido fijo bajo el scroll (botón principal, etc.). */
  footer?: ReactNode;
  header?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomEdge?: boolean;
}

export function Screen({ children, scroll = true, footer, header, refreshing, onRefresh, bottomEdge = true }: ScreenProps) {
  const { colors } = useSettings();
  return (
    <SafeAreaView edges={bottomEdge ? ['top', 'bottom'] : ['top']} style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.column, styles.flex]}>
          {header}
          {scroll ? (
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.gold} /> : undefined}>
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.flex, styles.padded]}>{children}</View>
          )}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface HeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Oculta el botón de volver (pantallas raíz de pestañas). */
  root?: boolean;
}

export function Header({ title, subtitle, onBack, right, root }: HeaderProps) {
  const { colors, t } = useSettings();
  const router = useRouter();
  const goBack = () => (onBack ? onBack() : router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={styles.header}>
      {!root ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={goBack}
          style={[styles.back, { backgroundColor: 'transparent', borderColor: colors.border }]}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.flex}>
        <AppText variant="title" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" tone="muted" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  content: { paddingHorizontal: 20, paddingBottom: 32, paddingTop: 4 },
  padded: { paddingHorizontal: 20 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14 },
  back: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
