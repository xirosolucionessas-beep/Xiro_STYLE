/**
 * Ruta no encontrada (Expo Router la muestra para cualquier dirección que no coincide con ninguna pantalla). Antes
 * mostraba la pantalla genérica en inglés de Expo ("Unmatched Route"); esta versión respeta la identidad de Xiro
 * (tema oscuro, acento dorado) y ofrece un camino de vuelta. Se renderiza dentro del mismo shell que el resto de la
 * app (barra lateral en la Web incluida), así que quien llega aquí nunca pierde la navegación.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { Button } from '@/ui/Button';
import { AppText } from '@/ui/Text';
import { space } from '@/ui/theme';

export default function NotFound() {
  const router = useRouter();
  const { t, colors } = useSettings();

  return (
    <View style={styles.wrap}>
      <View style={[styles.icon, { backgroundColor: colors.goldTint, borderColor: colors.gold }]}>
        <Ionicons name="compass-outline" size={36} color={colors.gold} />
      </View>
      <AppText variant="title" center tone="gold" style={{ marginBottom: space.sm }}>
        {t('not_found_title')}
      </AppText>
      <AppText center tone="muted" style={{ marginBottom: space.lg, maxWidth: 360 }}>
        {t('not_found_body')}
      </AppText>
      <Button label={t('not_found_cta')} icon="home-outline" onPress={() => router.replace('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, minHeight: 420 },
  icon: { width: 76, height: 76, borderRadius: 38, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
});
