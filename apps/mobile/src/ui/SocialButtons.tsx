import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppText } from './Text';
import { radius } from './theme';

/**
 * Botones de Google y Apple, en paridad con la Web. Están DESHABILITADOS a propósito ("Próximamente"): la API todavía
 * no tiene endpoints para validar el token de Google/Apple (ni hay credenciales OAuth configuradas), y un botón que
 * finge iniciar sesión sería peor que uno que dice la verdad. Cuando exista el backend, basta con pasar `available`
 * y un `onPress` por proveedor. Apple solo se ofrece donde existe "Iniciar sesión con Apple" (iOS y Web), no en Android.
 */
export function SocialButtons({ intent }: { intent: 'signin' | 'signup' }) {
  const { t, colors } = useSettings();
  const prefix = intent === 'signin' ? 'sign_in' : 'sign_up';
  const providers = (['google', 'apple'] as const).filter((provider) => provider !== 'apple' || Platform.OS !== 'android');

  return (
    <View style={styles.stack}>
      {providers.map((provider) => (
        <View
          key={provider}
          accessible
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityLabel={`${t(`${prefix}_${provider}`)}, ${t('coming_soon')}`}
          style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Ionicons name={provider === 'google' ? 'logo-google' : 'logo-apple'} size={20} color={colors.textMuted} />
          <AppText tone="muted" variant="bodyStrong" style={styles.label}>
            {t(`${prefix}_${provider}`)}
          </AppText>
          <AppText tone="gold" variant="small">
            {t('coming_soon')}
          </AppText>
        </View>
      ))}
      <AppText tone="muted" variant="small" center style={styles.note}>
        {t('social_note_soon')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10, marginBottom: 16 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: 16, opacity: 0.75 },
  label: { flex: 1 },
  note: { marginTop: 2 },
});
