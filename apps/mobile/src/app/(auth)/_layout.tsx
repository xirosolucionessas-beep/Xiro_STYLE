import { Redirect, Stack } from 'expo-router';
import { takePostAuthRedirect } from '@/lib/postAuthRedirect';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';

export default function AuthLayout() {
  const { status } = useSession();
  const { colors } = useSettings();
  if (status === 'signedIn') return <Redirect href={takePostAuthRedirect('/')} />;
  return <Stack initialRouteName="welcome" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
