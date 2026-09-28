import { AgendaPanel } from '@/ui/agenda/AgendaPanel';

/**
 * Citas (Android, iOS y Web): la agenda del negocio. Quién la ve lo decide src/lib/access.ts (permiso "ver mi agenda") y el
 * servidor lo impone en cada petición. Presentación en src/ui/agenda/AgendaPanel.tsx.
 */
export default function Agenda() {
  return <AgendaPanel />;
}
