import { useEffect, useState } from 'react';

/** Hora actual como estado, refrescada cada `intervalMs`: los "hace 10 min" y los cortes de día se actualizan solos y el render sigue siendo puro. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
