import { InfiniteQueryObserver, QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Page } from '@xiro/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { refreshFromStart } from '../src/lib/infinite';

/**
 * Fase 5: una lista con 5.000 clientes cargados son 100 páginas. TanStack Query, al volver a pedir una consulta infinita,
 * descarga OTRA VEZ todas sus páginas en serie (cada cursor sale de la anterior). "Deslizar para actualizar" ocurre arriba
 * de la lista, así que basta la primera página: refreshFromStart.
 */
const PAGE = 50;
const TOTAL = 5_000;
let client: QueryClient;
afterEach(() => client?.clear());

async function loadedList() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls: Array<string | undefined> = [];
  const observer = new InfiniteQueryObserver<Page<number>, Error, InfiniteData<Page<number>>, string[], string | undefined>(client, {
    queryKey: ['clients', 'pages', '{}'],
    queryFn: async ({ pageParam }) => {
      calls.push(pageParam);
      const start = pageParam ? Number(pageParam) : 0;
      const data = Array.from({ length: Math.min(PAGE, TOTAL - start) }, (_, i) => start + i);
      return { data, nextCursor: start + PAGE < TOTAL ? String(start + PAGE) : null };
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await observer.refetch();
  while (observer.getCurrentResult().hasNextPage) await observer.fetchNextPage();
  expect(observer.getCurrentResult().data!.pages.flatMap((p) => p.data)).toHaveLength(TOTAL);
  calls.length = 0;
  return { observer, calls, unsubscribe };
}

describe('lista paginada con 5.000 filas: actualizar', () => {
  it('refetch() de TanStack vuelve a pedir las 100 páginas en serie (el problema medido)', async () => {
    const { observer, calls, unsubscribe } = await loadedList();
    await observer.refetch();
    expect(calls).toHaveLength(TOTAL / PAGE);
    unsubscribe();
  });

  it('refreshFromStart pide solo la primera página y deja la lista con datos frescos (sin parpadeo a vacío)', async () => {
    const { observer, calls, unsubscribe } = await loadedList();
    const states: number[] = [];
    const stop = observer.subscribe((result) => states.push(result.data?.pages.length ?? 0));
    await refreshFromStart(client, ['clients', 'pages', '{}']);
    expect(calls).toEqual([undefined]);
    const after = observer.getCurrentResult();
    expect(after.data!.pages).toHaveLength(1);
    expect(after.data!.pages[0]!.data[0]).toBe(0);
    expect(after.hasNextPage).toBe(true);
    expect(states.every((pages) => pages >= 1)).toBe(true); // nunca queda sin datos mientras recarga
    // Y seguir bajando continúa desde la página 2, como siempre.
    await observer.fetchNextPage();
    expect(calls).toEqual([undefined, '50']);
    stop();
    unsubscribe();
  });
});
