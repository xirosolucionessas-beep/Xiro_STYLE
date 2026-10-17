import { Redirect, Stack, usePathname } from 'expo-router';
import { usePlatformSession } from '@/lib/platformApi';
import { useSettings } from '@/lib/settings';

/**
 * Panel del fundador (/platform). Fuera del grupo (app): no depende de la sesión de un negocio ni de sus permisos. La
 * autorización real la hace el servidor en cada petición; aquí solo se evita mostrar pantallas sin sesión de plataforma.
 * No hay enlace a esta sección en la app: se entra escribiendo la dirección (web) o con el enlace xirostyle://platform.
 */
export default function PlatformLayout() {
  const { colors } = useSettings();
  const { token } = usePlatformSession();
  const pathname = usePathname();
  if (!token && pathname !== '/platform') return <Redirect href="/platform" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
