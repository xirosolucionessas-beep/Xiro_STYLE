import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';
import { SettingsProvider, useSettings } from '@/lib/settings';
import { WebShell } from '@/shell/WebShell';
import { ConnectionError } from '@/ui/ConnectionError';
import { DialogsProvider } from '@/ui/Dialogs';

void SplashScreen.preventAutoHideAsync();

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
    },
  });
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <DialogsProvider>
            <SessionProvider>
              <Gate />
            </SessionProvider>
          </DialogsProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const { status, retryBoot } = useSession();
  const { colors, theme } = useSettings();
  // Tras "Reintentar conexión" la sesión pasa a 'loading': si venía de un fallo se mantiene la tarjeta (con su indicador de
  // carga) en vez de dejar la pantalla en blanco hasta que se sepa el resultado.
  const [failedBefore, setFailedBefore] = useState(false);
  if (status === 'error' && !failedBefore) setFailedBefore(true);
  if ((status === 'signedIn' || status === 'signedOut') && failedBefore) setFailedBefore(false);

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  // En nativo esto queda tapado por el splash del sistema (se oculta justo cuando 'loading' termina, ver arriba), pero
  // en web no hay splash nativo: sin este indicador, validar la sesión guardada (una llamada real a la API) se vería
  // como una pantalla en blanco durante ese primer instante.
  if (status === 'loading' && !failedBefore) {
    return (
      <View style={[styles.boot, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  if (status === 'error' || status === 'loading') return <ConnectionError retrying={status === 'loading'} onRetry={retryBoot} />;

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <WebShell>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
      </WebShell>
    </>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
