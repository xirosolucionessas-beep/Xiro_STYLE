import { Redirect, Stack, usePathname } from 'expo-router';
import { Platform } from 'react-native';
import { actorOf, meets, routeRequirement } from '@/lib/access';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { SubscriptionGate } from '@/ui/SubscriptionGate';

export default function AppLayout() {
  const { status, user } = useSession();
  const { colors } = useSettings();
  const pathname = usePathname();
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  // Pantallas que esta persona no puede usar (por rol/permisos) → inicio. El servidor las rechaza igual con 403.
  if (status === 'signedIn' && !meets(actorOf(user), routeRequirement(pathname))) return <Redirect href="/" />;
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
      {/* En Web la monta WebShell.web.tsx (versión con el sistema de diseño xw-*): este _layout no tiene
          hermano .web.tsx propio (cambiaría la estructura de navegación), así que se evita aquí a mano. */}
      {Platform.OS !== 'web' ? <SubscriptionGate /> : null}
    </>
  );
}
