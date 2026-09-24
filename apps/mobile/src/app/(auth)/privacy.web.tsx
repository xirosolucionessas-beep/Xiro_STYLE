/** Ruta /privacy SOLO WEB (sin equivalente nativo: la app móvil no divide Términos/Privacidad hoy). Presentación en src/web/screens/Legal.tsx. */
import { useRouter } from 'expo-router';
import { PrivacyView } from '@/web/screens/Legal';
import { useWebText } from '@/web/services/useWebText';

export default function PrivacyWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  return <PrivacyView t={t} language={language} onBack={() => (router.canGoBack() ? router.back() : router.replace('/register'))} />;
}
