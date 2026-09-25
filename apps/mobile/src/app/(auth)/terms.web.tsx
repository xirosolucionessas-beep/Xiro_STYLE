/** Ruta /terms SOLO WEB (nativo: terms.tsx, sin cambios). Presentación en src/web/screens/Legal.tsx. */
import { useRouter } from 'expo-router';
import { useSession } from '@/lib/session';
import { TermsView } from '@/web/screens/Legal';
import { useWebText } from '@/web/services/useWebText';

export default function TermsWeb() {
  const router = useRouter();
  const { t: baseT, language } = useWebText();
  const { status } = useSession();
  // Con la sesión iniciada (llegan desde el aviso de cookies) el botón vuelve a donde estaban, no "al registro".
  const t = (key: string) => (key === 'legal_back' && status === 'signedIn' ? baseT('back') : baseT(key));
  return <TermsView t={t} language={language} onBack={() => (router.canGoBack() ? router.back() : router.replace('/register'))} />;
}
