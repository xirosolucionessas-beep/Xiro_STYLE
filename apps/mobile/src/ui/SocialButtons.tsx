import { StyleSheet, View } from 'react-native';
import { useSettings } from '@/lib/settings';
import { AppleLogo, GoogleLogo } from './BrandLogos';
import { AppText } from './Text';
import { radius } from './theme';

/**
 * Botones de Google y Apple, en paridad con la Web. Están DESHABILITADOS a propósito ("Próximamente"): la API todavía
 * no tiene endpoints para validar el token de Google/Apple ni hay credenciales OAuth configuradas, y un botón que
 * finge iniciar sesión sería peor que uno que dice la verdad. Cuando exista el backend basta con pasar `onPress`
 * por proveedor (el diseño, el logo y los estados ya están). Apple se muestra en iOS y Android: en iOS será el botón
 * nativo del sistema y en Android el flujo web de Apple, igual que en la Web.
 */
export function SocialButtons({ intent }: { intent: 'signin' | 'signup' }) {
  const { t, colors } = useSettings();
  const prefix = intent === 'signin' ? 'sign_in' : 'sign_up';

  return (
    <View style={styles.stack}>
      {(['google', 'apple'] as const).map((provider) => {
        const label = t(`${prefix}_${provider}`);
        return (
          <View
            key={provider}
            accessible
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel={`${label}, ${t('coming_soon')}`}
            style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.logo}>{provider === 'google' ? <GoogleLogo size={20} /> : <AppleLogo size={20} color={colors.text} />}</View>
            <View style={styles.text}>
              <AppText tone="muted" variant="bodyStrong" numberOfLines={2}>
                {label}
              </AppText>
              <AppText tone="gold" variant="small">
                {t('coming_soon')}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: 16, opacity: 0.8 },
  logo: { width: 24, alignItems: 'center' },
  text: { flex: 1, paddingVertical: 6 },
});
