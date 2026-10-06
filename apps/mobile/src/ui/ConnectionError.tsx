/**
 * Pantalla "No pudimos conectar con el servidor" (Android/iOS): se muestra al abrir la app cuando no se pudo validar la
 * sesión por falta de conexión. Tarjeta centrada, oscura y con borde dorado sobre un fondo con brillo dorado; el botón
 * "Reintentar conexión" es contenido (ancho automático) y muestra un indicador de carga mientras reintenta.
 * La versión web es ConnectionError.web.tsx (mismo API: test/variants.parity.test.ts lo vigila).
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '@/lib/settings';
import { Button } from './Button';

const GOLD = '#d9b636';
const MUTED = '#c9c3b6';
/** Tiempo mínimo que se ve el indicador al reintentar, para que el toque siempre tenga respuesta visible. */
const MIN_SPINNER_MS = 900;

export function ConnectionError({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  const { t } = useSettings();
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!pressed) return;
    const id = setTimeout(() => setPressed(false), MIN_SPINNER_MS);
    return () => clearTimeout(id);
  }, [pressed]);

  return (
    <SafeAreaView style={styles.root}>
      <LinearGradient colors={['#17140a', '#0d0d0f', '#0d0d0f']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.center}>
        <LinearGradient colors={['rgba(217,182,54,0.55)', 'rgba(217,182,54,0.12)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.border}>
          <View style={styles.card} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <View style={styles.icon}>
              <Ionicons name="cloud-offline-outline" size={32} color={GOLD} />
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {t('conn_title')}
            </Text>
            <Text style={styles.body}>{t('offline_error')}</Text>
            <Button label={t('conn_retry')} icon="refresh" loading={pressed || retrying} onPress={() => (setPressed(true), onRetry())} style={styles.button} />
          </View>
        </LinearGradient>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0d0f' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  border: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 26,
    padding: 1.5,
    // Mismo brillo dorado en los tres: en web "boxShadow" directo (RNW también lo hace en tiempo real desde shadow*,
    // pero de paso avisa que está obsoleto), en iOS shadow* de toda la vida, en Android sin sombra (como ya era).
    ...Platform.select({ web: { boxShadow: `0px 8px 26px ${GOLD}59` }, ios: { shadowColor: GOLD, shadowOpacity: 0.35, shadowRadius: 26, shadowOffset: { width: 0, height: 8 } } }),
  },
  card: { alignItems: 'center', borderRadius: 24.5, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24, backgroundColor: 'rgba(14,13,10,0.94)' },
  icon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 16, backgroundColor: 'rgba(217,182,54,0.14)', borderWidth: 1, borderColor: 'rgba(217,182,54,0.45)' },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { color: MUTED, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8, marginBottom: 22 },
  button: { alignSelf: 'center', paddingHorizontal: 28, minWidth: 200 },
});
