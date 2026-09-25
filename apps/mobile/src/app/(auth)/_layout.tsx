import { Redirect, Stack, usePathname } from 'expo-router';
import { useMemo } from 'react';
import { takePostAuthRedirect } from '@/lib/postAuthRedirect';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';

export default function AuthLayout() {
  const { status } = useSession();
  const { colors } = useSettings();
  const pathname = usePathname();
  // Términos y Privacidad se pueden leer con la sesión iniciada (los enlaza el aviso de cookies): no se redirige desde ahí.
  const legal = pathname === '/terms' || pathname === '/privacy';
  // El destino es de un solo uso: se toma UNA vez al iniciar sesión (no en cada render, que se repite al cambiar la ruta).
  const signedIn = status === 'signedIn';
  const redirectTo = useMemo(() => (signedIn ? takePostAuthRedirect('/') : null), [signedIn]);
  if (signedIn && !legal && redirectTo) return <Redirect href={redirectTo} />;
  return <Stack initialRouteName="welcome" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
