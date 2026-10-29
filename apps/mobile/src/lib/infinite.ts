import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Actualizar una lista paginada desde arriba ("deslizar para actualizar"): se queda solo con la primera página y la vuelve a
 * pedir. `refetch()` de TanStack descargaría OTRA VEZ todas las páginas ya cargadas, en serie: 100 peticiones con 5.000
 * clientes vistos (Fase 5, test/infiniteRefresh.logic.test.ts). La lista nunca queda vacía mientras recarga y seguir
 * bajando continúa desde la página 2.
 */
export function refreshFromStart(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  queryClient.setQueryData<InfiniteData<unknown, unknown>>(queryKey, (data) => (data && data.pages.length > 1 ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data));
  return queryClient.refetchQueries({ queryKey, exact: true });
}
