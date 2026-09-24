import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';
import { SettingsProvider, useSettings } from '@/lib/settings';
import { WebShell } from '@/shell/WebShell';
import { Button } from '@/ui/Button';
import { DialogsProvider } from '@/ui/Dialogs';
import { Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

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
  const { colors, theme, t } = useSettings();

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return null;

  if (status === 'error') {
    return (
      <Screen scroll={false}>
        <AppText variant="title" center style={{ marginTop: 120 }}>
          {t('app_name')}
        </AppText>
        <AppText tone="muted" center style={{ marginVertical: 16 }}>
          {t('offline_error')}
        </AppText>
        <Button label={t('retry')} onPress={retryBoot} />
      </Screen>
    );
  }

  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <WebShell>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
      </WebShell>
    </>
  );
}
