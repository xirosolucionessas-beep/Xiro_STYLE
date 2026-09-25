import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { greetingKey, msUntilNextGreeting, type GreetingKey } from './greeting';

/**
 * Saludo según la hora local, siempre al día: se recalcula al volver la app al primer plano y al cruzar 05:00, 12:00 o
 * 19:00 con la pantalla abierta, sin reiniciar. Se reprograma en tramos de máximo 30 s (evita temporizadores largos, que
 * Android puede pausar) y se apoya en `msUntilNextGreeting` para no esperar de más cerca de un límite.
 */
export function useGreetingKey(): GreetingKey {
  const [key, setKey] = useState<GreetingKey>(() => greetingKey(new Date().getHours()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => setKey(greetingKey(new Date().getHours()));
    const schedule = () => {
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, Math.min(30_000, msUntilNextGreeting(new Date()) + 250));
    };
    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refresh();
      clearTimeout(timer);
      schedule();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return key;
}
