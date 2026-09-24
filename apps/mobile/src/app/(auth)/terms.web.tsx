/** Ruta /terms SOLO WEB (nativo: terms.tsx, sin cambios). Presentación en src/web/screens/Legal.tsx. */
import { useRouter } from 'expo-router';
import { TermsView } from '@/web/screens/Legal';
import { useWebText } from '@/web/services/useWebText';

export default function TermsWeb() {
  const router = useRouter();
  const { t, language } = useWebText();
  return <TermsView t={t} language={language} onBack={() => (router.canGoBack() ? router.back() : router.replace('/register'))} />;
}
