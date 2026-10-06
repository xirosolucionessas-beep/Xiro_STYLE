import { BookingPanel } from '@/ui/booking/BookingPanel';

/**
 * Mi página web (Android, iOS y Web): enlace, presentación, reglas de agenda, equipo y reseñas de la página de reservas.
 * Solo quien tiene el permiso "gestionar la página pública" (por defecto, el dueño): src/lib/access.ts y el servidor.
 */
export default function Booking() {
  return <BookingPanel />;
}
