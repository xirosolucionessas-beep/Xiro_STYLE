/**
 * Aviso de cookies del primer ingreso (Android/iOS). Tarjeta oscura con borde dorado que sube desde abajo con un
 * fundido suave; siempre oscura (es parte de la estética premium, igual en tema claro y oscuro). La versión web es
 * src/web/ui/CookieConsent.tsx y comparte la lógica (lib/cookieConsent.ts, lib/useCookieConsent.ts) y los textos.
 * Solo se cierra aceptando: el botón atrás de Android no la descarta.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { useCookieConsent } from '@/lib/useCookieConsent';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';

const GOLD = '#d9b636';
const TEXT = '#ffffff';
const MUTED = '#c9c3b6';

export function CookieConsent() {
  const { t } = useSettings();
  const router = useRouter();
  const pathname = usePathname();
  const { visible, accept } = useCookieConsent();
  // Mientras se leen los Términos o la Privacidad el aviso se aparta (seguirá ahí al volver, hasta aceptar).
  const reading = pathname === '/terms' || pathname === '/privacy';
  const open = visible && !reading;

  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!open) {
      progress.setValue(0);
      return;
    }
    Animated.timing(progress, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, progress]);

  const link = (label: string, href: '/terms' | '/privacy') => (
    <Text accessibilityRole="link" onPress={() => router.push(href)} style={styles.link}>
      {label}
    </Text>
  );

  return (
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Animated.View style={[styles.wrap, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] }]}>
          <LinearGradient colors={['rgba(217,182,54,0.55)', 'rgba(217,182,54,0.12)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.border}>
            <View style={styles.card} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <View style={styles.head}>
                <View style={styles.icon}>
                  <Ionicons name="shield-checkmark-outline" size={22} color={GOLD} />
                </View>
                <Text accessibilityRole="header" style={styles.title}>
                  {t('cookies_title')}
                </Text>
              </View>
              <Text style={styles.body}>
                {t('cookies_body')} {t('cookies_more')} {link(t('cookies_terms'), '/terms')} {t('cookies_and')} {link(t('cookies_privacy'), '/privacy')}.
              </Text>
              <Button label={t('cookies_accept')} onPress={accept} />
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 24, backgroundColor: 'rgba(0,0,0,0.55)' },
  wrap: { width: '100%', maxWidth: 520, alignSelf: 'center', shadowColor: GOLD, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  border: { borderRadius: 24, padding: 1.5 },
  card: { borderRadius: 22.5, padding: 20, gap: 14, backgroundColor: 'rgba(14,13,10,0.96)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(217,182,54,0.14)', borderWidth: 1, borderColor: 'rgba(217,182,54,0.4)' },
  title: { flex: 1, color: TEXT, fontSize: 18, fontWeight: '800' },
  body: { color: MUTED, fontSize: 14, lineHeight: 22 },
  link: { color: GOLD, textDecorationLine: 'underline' },
});
