/**
 * Ruta /welcome SOLO WEB. Expo Router usa este archivo en el navegador; Android/iOS siguen con welcome.tsx, que no se toca
 * (metro.config.js excluye los *.web.tsx de src/app de los bundles nativos). La presentación vive en src/web/screens/Welcome.tsx.
 */
import { useRouter } from 'expo-router';
import { useSettings } from '@/lib/settings';
import { Brand } from '@/ui/Brand';
import { Chip } from '@/ui/Kit';
import { WelcomeView } from '@/web/screens/Welcome';
import { useSocialAuth } from '@/web/services/useSocialAuth';
import { useWebText } from '@/web/services/useWebText';

export default function WelcomeWeb() {
  const router = useRouter();
  const { setLanguage, theme, setTheme } = useSettings();
  const { t, language } = useWebText();
  const { state, start } = useSocialAuth(t, 'signin');

  return (
    <WelcomeView
      language={language}
      theme={theme}
      t={t}
      logo={(size) => <Brand size={size} />}
      languagePicker={
        <>
          <Chip label="ES" selected={language === 'es'} onPress={() => setLanguage('es')} />
          <Chip label="EN" selected={language === 'en'} onPress={() => setLanguage('en')} />
        </>
      }
      onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      onLogin={() => router.push('/login')}
      onRegister={() => router.push('/register')}
      onTerms={() => router.push('/terms')}
      social={state}
      onSocial={(provider) => void start(provider)}
    />
  );
}
