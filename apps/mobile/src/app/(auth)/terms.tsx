import { useSettings } from '@/lib/settings';
import { Header, Screen } from '@/ui/Screen';
import { AppText } from '@/ui/Text';

export default function Terms() {
  const { t } = useSettings();
  return (
    <Screen header={<Header title={t('terms_title')} />}>
      <AppText tone="muted">{t('terms_body')}</AppText>
    </Screen>
  );
}
