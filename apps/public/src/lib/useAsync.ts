import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

interface Resolved<T> {
  key: string;
  data?: T;
  error?: unknown;
}

/**
 * Trae datos de solo lectura de la API pública: sin caché entre pantallas ni invalidaciones (cada visita es una sesión
 * corta y sin cuenta, así que no hace falta algo como React Query aquí). `deps` cambia cuándo se vuelve a pedir.
 *
 * `loading` se DERIVA comparando la clave de la última respuesta resuelta con la clave actual (en vez de un
 * `setState(true)` síncrono al inicio del efecto): así solo se actualiza estado desde los callbacks async del fetch.
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: ReadonlyArray<unknown>): AsyncState<T> {
  const [tick, setTick] = useState(0);
  const key = `${JSON.stringify(deps)}:${tick}`;
  const [resolved, setResolved] = useState<Resolved<T>>({ key: '' });
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let active = true;
    fetcherRef
      .current()
      .then((data) => {
        if (active) setResolved({ key, data });
      })
      .catch((error: unknown) => {
        if (active) setResolved({ key, error });
      });
    return () => {
      active = false;
    };
  }, [key]);

  return { data: resolved.key === key ? resolved.data : undefined, loading: resolved.key !== key, error: resolved.key === key ? resolved.error : undefined, reload: () => setTick((t) => t + 1) };
}

/** Clave de traducción del error (código de la API si existe, o el genérico). */
export const errorKey = (error: unknown): string => (error instanceof ApiError ? (error.isNetwork ? (error.code === 'timeout_error' ? 'timeout_error' : 'offline_error') : error.code) : 'unknown_error');
