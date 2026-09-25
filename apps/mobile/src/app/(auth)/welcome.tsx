import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { supportMailtoUrl, supportMessage, supportWhatsappUrl, XIRO_CONTACT } from '@/lib/contact';
import { useSettings } from '@/lib/settings';
import { Brand } from '@/ui/Brand';
import { Button } from '@/ui/Button';
import { useDialogs } from '@/ui/Dialogs';
import { Card, Chip, Row } from '@/ui/Kit';
import { OrDivider } from '@/ui/OrDivider';
import { Screen } from '@/ui/Screen';
import { SocialButtons } from '@/ui/SocialButtons';
import { AppText } from '@/ui/Text';

export default function Welcome() {
  const router = useRouter();
  const { t, language, setLanguage, theme, setTheme, colors } = useSettings();
  const { toast } = useDialogs();
  const open = (url: string) => void Linking.openURL(url).catch(() => toast(t('unknown_error')));

  return (
    <Screen>
      <View style={styles.top}>
        <View style={styles.langs} role="radiogroup" aria-label={t('language')}>
          <Chip label="ES" selected={language === 'es'} onPress={() => setLanguage('es')} />
          <Chip label="EN" selected={language === 'en'} onPress={() => setLanguage('en')} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('dark_mode')}
          onPress={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          style={[styles.theme, { borderColor: colors.border }]}>
          <Ionicons name={theme === 'dark' ? 'sunny-outline' : 'moon-outline'} size={20} color={colors.gold} />
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Brand size={132} />
        <AppText variant="display" center style={styles.title}>
          {t('welcome_title')}
        </AppText>
        <AppText tone="gold" variant="bodyStrong" center>
          {t('tagline')}
        </AppText>
      </View>

      <Button label={t('login')} onPress={() => router.push('/login')} />
      <Button label={t('create_account')} variant="secondary" onPress={() => router.push('/register')} style={styles.second} />

      <OrDivider label={t('or_sign_in_with')} />
      <SocialButtons intent="signin" />

      <Pressable accessibilityRole="link" onPress={() => router.push('/terms')} style={styles.terms}>
        <AppText tone="gold" variant="bodyStrong" center>
          {t('terms_link')}
        </AppText>
      </Pressable>

      <AppText variant="heading" style={styles.help}>
        {t('support_heading')}
      </AppText>
      <Card>
        <Row icon="logo-whatsapp" label={t('support_whatsapp_label')} value={XIRO_CONTACT.whatsappDisplay} onPress={() => open(supportWhatsappUrl(supportMessage(language)))} />
        <Row icon="mail-outline" label={t('support_email_label')} value={XIRO_CONTACT.email} onPress={() => open(supportMailtoUrl())} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12 },
  langs: { flexDirection: 'row', gap: 8 },
  theme: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  title: { marginTop: 22 },
  second: { marginTop: 12 },
  terms: { minHeight: 48, justifyContent: 'center', marginTop: 4 },
  help: { marginTop: 12, marginBottom: 10 },
});
