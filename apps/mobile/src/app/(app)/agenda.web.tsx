/**
 * Ruta /agenda (Citas) SOLO WEB (fallback nativo: agenda.tsx redirige al inicio). El módulo de citas aún no existe:
 * la pantalla lo dice ("Próximamente") y no muestra datos de ejemplo. Presentación en src/web/screens/Agenda.tsx.
 */
import { useRouter } from 'expo-router';
import { Header, Screen } from '@/ui/Screen';
import { AgendaView } from '@/web/screens/Agenda';
import { useWebText } from '@/web/services/useWebText';

export default function AgendaWeb() {
  const router = useRouter();
  const { t } = useWebText();
  return (
    <Screen header={<Header root title={t('nav_agenda')} subtitle={t('sec_agenda_sub')} />}>
      <AgendaView t={t} navigate={(href) => router.push(href as never)} />
    </Screen>
  );
}
