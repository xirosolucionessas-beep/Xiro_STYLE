import { useEffect, useState } from 'react';
import { greetingKeyIn, type GreetingKey } from '../../lib/greeting';

/**
 * Saludo según la hora del NEGOCIO (05:00 mañana · 12:00 tarde · 19:00 noche), siempre al día: se recalcula cada 30 s y
 * al volver a la pestaña, así cambia solo al cruzar la hora sin recargar.
 */
export function useBusinessGreeting(timezone: string): GreetingKey {
  const [key, setKey] = useState<GreetingKey>(() => greetingKeyIn(timezone, new Date()));
  useEffect(() => {
    const refresh = () => setKey(greetingKeyIn(timezone, new Date()));
    refresh();
    const id = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [timezone]);
  return key;
}
