/** Ruta /privacy SOLO WEB (sin equivalente nativo: la app móvil no divide Términos/Privacidad hoy). Presentación en src/web/screens/Legal.tsx. */
import { useRouter } from 'expo-router';
import { useSession } from '@/lib/session';
import { PrivacyView } from '@/web/screens/Legal';
import { useWebText } from '@/web/services/useWebText';

export default function PrivacyWeb() {
  const router = useRouter();
  const { t: baseT, language } = useWebText();
  const { status } = useSession();
  // Con la sesión iniciada (llegan desde el aviso de cookies) el botón vuelve a donde estaban, no "al registro".
  const t = (key: string) => (key === 'legal_back' && status === 'signedIn' ? baseT('back') : baseT(key));
  return <PrivacyView t={t} language={language} onBack={() => (router.canGoBack() ? router.back() : router.replace('/register'))} />;
}
