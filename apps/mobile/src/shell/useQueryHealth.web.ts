import { isTranslationKey } from '@xiro/shared';
import { useIsFetching, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { errorKey } from '@/lib/api';

/** Consultas activas en error, como texto estable (para useSyncExternalStore): "clave:código|clave:código". */
function failedSnapshot(client: QueryClient): string {
  return client
    .getQueryCache()
    .findAll({ type: 'active' })
    .filter((query) => query.state.status === 'error')
    .map((query) => `${JSON.stringify(query.queryKey)}:${errorKey(query.state.error)}`)
    .sort()
    .join('|');
}

/**
 * Estado global de datos para el shell web: si alguna consulta activa falló (tras sus reintentos automáticos) devuelve
 * el mensaje traducido y una función para reintentarlas; `busy` indica que hay peticiones en curso.
 */
export function useQueryHealth(t: (key: string) => string) {
  const client = useQueryClient();
  const busy = useIsFetching() > 0;
  const snapshot = useSyncExternalStore(
    useCallback((notify: () => void) => client.getQueryCache().subscribe(notify), [client]),
    () => failedSnapshot(client),
    () => '',
  );
  const retry = useCallback(() => void client.refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' }), [client]);

  if (!snapshot) return { busy, error: undefined };
  const code = snapshot.split('|')[0]!.split(':').pop()!;
  return { busy, error: { message: t(isTranslationKey(code) ? code : 'unknown_error'), retryLabel: t('retry'), onRetry: retry } };
}
