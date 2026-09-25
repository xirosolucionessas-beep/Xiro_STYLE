import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Linking, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supportMailtoUrl, supportMessage, supportWhatsappUrl, XIRO_CONTACT } from '@/lib/contact';
import { isCurrentItem, type MenuItem, type MenuSection } from '@/lib/menu';
import { useSettings } from '@/lib/settings';
import type { BusinessType, Language } from '@xiro/shared';
import { Toggle } from '../Kit';
import { Brand } from '../Brand';
import { AppText } from '../Text';
import { radius } from '../theme';

interface Props {
  open: boolean;
  onClose: () => void;
  sections: MenuSection[];
  pathname: string;
  business: { name: string; type: BusinessType; logoUrl: string | null };
  user: { name: string; role: 'owner' | 'employee' };
  /** Insignias de conteo por ítem (p. ej. inventario con bajo stock). */
  badges: Partial<Record<string, number>>;
  language: Language;
  dark: boolean;
  onLanguage: (language: Language) => void;
  onDark: (dark: boolean) => void;
  onNavigate: (href: string) => void;
  onSoon: () => void;
  onAccount: () => void;
  onNotifications: () => void;
  onLogout: () => void;
}

const WIDTH_RATIO = 0.86;
const MAX_WIDTH = 340;
const MIN_TOUCH = 48;

/**
 * Menú lateral (tres rayitas) con todas las funciones. Solo navega a pantallas existentes y no duplica lógica: cada
 * acción la resuelve el contenedor (Inicio). Se cierra al tocar fuera, con el gesto/botón de atrás del sistema o al
 * elegir una opción. Respeta "reducir movimiento" y las zonas seguras. No reemplaza la pestaña "Más".
 */
export function SideMenu(props: Props) {
  const { open, onClose } = props;
  const { t, colors } = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(MAX_WIDTH, Math.round(width * WIDTH_RATIO));
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (open) setMounted(true);
    const duration = reduceMotion ? 0 : 220;
    Animated.timing(progress, { toValue: open ? 1 : 0, duration, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, progress, reduceMotion]);

  if (!mounted) return null;

  const go = (item: MenuItem) => {
    onClose();
    if (item.soon || !item.href) return props.onSoon();
    props.onNavigate(item.href);
  };
  const openUrl = (url: string) => void Linking.openURL(url).catch(() => props.onSoon());

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] });

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress, backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('menu_close')} style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View style={[styles.panel, { width: panelWidth, backgroundColor: colors.background, borderRightColor: colors.border, paddingTop: insets.top, paddingBottom: insets.bottom, transform: [{ translateX }] }]}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${props.user.name}. ${props.business.name}`} onPress={() => { onClose(); props.onAccount(); }} style={styles.header}>
              <Brand size={52} logoUrl={props.business.logoUrl} />
              <View style={{ flex: 1 }}>
                <AppText variant="heading" numberOfLines={2}>
                  {props.business.name}
                </AppText>
                <AppText tone="muted" variant="small" numberOfLines={1}>
                  {t(`type_${props.business.type}`)}
                </AppText>
                <View style={styles.userRow}>
                  <View style={[styles.avatar, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
                    <AppText variant="small" tone="gold" style={{ fontWeight: '800' }}>
                      {props.user.name.trim().charAt(0).toUpperCase()}
                    </AppText>
                  </View>
                  <AppText variant="small" numberOfLines={1} style={{ flex: 1 }}>
                    {props.user.name} · {t('account')}
                  </AppText>
                </View>
              </View>
            </Pressable>

            {props.sections.map((section) => (
              <View key={section.id}>
                <AppText variant="label" tone="gold" style={styles.sectionTitle} accessibilityRole="header">
                  {t(section.titleKey).toUpperCase()}
                </AppText>
                {section.items.map((item) => {
                  const current = isCurrentItem(item, props.pathname);
                  const badge = item.badge ? props.badges[item.id] : undefined;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: current }}
                      accessibilityLabel={`${t(item.labelKey)}${item.soon ? `, ${t('coming_soon')}` : ''}${current ? `, ${t('menu_current')}` : ''}${badge ? `, ${badge}` : ''}`}
                      onPress={() => go(item)}
                      style={[styles.item, current && { backgroundColor: colors.goldTint }]}>
                      <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={22} color={colors.gold} />
                      <AppText variant="bodyStrong" style={{ flex: 1 }} tone={current ? 'gold' : 'text'}>
                        {t(item.labelKey)}
                      </AppText>
                      {item.soon ? (
                        <AppText variant="small" tone="muted">
                          {t('coming_soon')}
                        </AppText>
                      ) : null}
                      {badge ? (
                        <View style={[styles.badge, { backgroundColor: colors.warning }]}>
                          <AppText variant="small" style={{ color: '#17130a', fontWeight: '800' }}>
                            {badge}
                          </AppText>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <AppText variant="label" tone="gold" style={styles.sectionTitle} accessibilityRole="header">
              {t('menu_section_prefs').toUpperCase()}
            </AppText>
            <View style={styles.item}>
              <Ionicons name="language-outline" size={22} color={colors.gold} />
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {t('language')}
              </AppText>
              {(['es', 'en'] as const).map((code) => (
                <Pressable key={code} accessibilityRole="button" accessibilityState={{ selected: props.language === code }} accessibilityLabel={t(`language_${code}`)} onPress={() => props.onLanguage(code)} style={[styles.langChip, { borderColor: props.language === code ? colors.gold : colors.border, backgroundColor: props.language === code ? colors.goldTint : 'transparent' }]}>
                  <AppText variant="small" tone={props.language === code ? 'gold' : 'muted'} style={{ fontWeight: '800' }}>
                    {code.toUpperCase()}
                  </AppText>
                </Pressable>
              ))}
            </View>
            <View style={styles.item}>
              <Ionicons name="moon-outline" size={22} color={colors.gold} />
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {t('dark_mode')}
              </AppText>
              <Toggle value={props.dark} onChange={props.onDark} label={t('dark_mode')} />
            </View>
            <Pressable accessibilityRole="button" onPress={() => { onClose(); props.onNotifications(); }} style={styles.item}>
              <Ionicons name="notifications-outline" size={22} color={colors.gold} />
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {t('notifications')}
              </AppText>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>

            <AppText variant="label" tone="gold" style={styles.sectionTitle} accessibilityRole="header">
              {t('menu_section_help').toUpperCase()}
            </AppText>
            <Pressable accessibilityRole="link" accessibilityLabel={`${t('support_whatsapp_label')} ${XIRO_CONTACT.whatsappDisplay}`} onPress={() => { onClose(); openUrl(supportWhatsappUrl(supportMessage(props.language))); }} style={styles.item}>
              <Ionicons name="logo-whatsapp" size={22} color={colors.gold} />
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {t('support_whatsapp_label')}
              </AppText>
            </Pressable>
            <Pressable accessibilityRole="link" accessibilityLabel={`${t('support_email_label')} ${XIRO_CONTACT.email}`} onPress={() => { onClose(); openUrl(supportMailtoUrl()); }} style={styles.item}>
              <Ionicons name="mail-outline" size={22} color={colors.gold} />
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {t('support_email_label')}
              </AppText>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => { onClose(); props.onNavigate('/terms'); }} style={styles.item}>
              <Ionicons name="document-text-outline" size={22} color={colors.gold} />
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {t('terms_link')}
              </AppText>
            </Pressable>

            <Pressable accessibilityRole="button" onPress={() => { onClose(); props.onLogout(); }} style={[styles.item, { marginTop: 10 }]}>
              <Ionicons name="log-out-outline" size={22} color={colors.danger} />
              <AppText variant="bodyStrong" tone="danger" style={{ flex: 1 }}>
                {t('logout')}
              </AppText>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRightWidth: StyleSheet.hairlineWidth },
  scroll: { paddingHorizontal: 12, paddingBottom: 24 },
  header: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 16, paddingHorizontal: 4, minHeight: MIN_TOUCH },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  avatar: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { marginTop: 16, marginBottom: 4, paddingHorizontal: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: MIN_TOUCH, paddingHorizontal: 8, borderRadius: radius.md },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  langChip: { minWidth: 44, minHeight: 36, borderWidth: 1, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
});
