import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { ClientsQuery, ItemsQuery, Page } from '@xiro/shared';
import { api, fetchAllPages } from './api';

export const keys = {
  items: ['items'] as const,
  categories: ['categories'] as const,
  clients: ['clients'] as const,
  cash: ['cash'] as const,
  subscription: ['subscription'] as const,
  subscriptionInvoices: ['subscriptionInvoices'] as const,
  loyaltyProgram: ['loyaltyProgram'] as const,
  loyaltyClients: ['loyaltyClients'] as const,
  loyaltyRedemptions: ['loyaltyRedemptions'] as const,
  serviceRecords: ['serviceRecords'] as const,
  sales: ['sales'] as const,
  expenses: ['expenses'] as const,
  cashCloseSummary: ['cashCloseSummary'] as const,
  cashClosings: ['cashClosings'] as const,
  notificationSettings: ['notificationSettings'] as const,
  notifications: ['notifications'] as const,
  employees: ['employees'] as const,
  auditLogs: ['auditLogs'] as const,
  appointments: ['appointments'] as const,
  professionals: ['professionals'] as const,
  bookingSettings: ['bookingSettings'] as const,
  closures: ['closures'] as const,
  bookingReviews: ['bookingReviews'] as const,
  packages: ['packages'] as const,
  variants: ['variants'] as const,
  classification: ['classification'] as const,
  placesConfig: ['placesConfig'] as const,
  messagePeople: ['messagePeople'] as const,
  conversations: ['conversations'] as const,
  conversationMessages: ['conversationMessages'] as const,
};

/* ---------- Listados paginados (cursor) ----------
 * Pantallas con lista larga → `use…Pages` (useInfiniteQuery + `fetchNextPage` al llegar al final). Buscadores →
 * primera página con búsqueda en el servidor. Indicadores → `…Summary` (sin descargar listas). Todas las claves cuelgan
 * de su prefijo (`keys.items`, `keys.clients`, …): las invalidaciones de siempre refrescan listas y resúmenes. */

/** Todas las filas ya cargadas de un useInfiniteQuery, en orden. */
export const flatPages = <T,>(data: InfiniteData<Page<T>> | undefined): T[] => data?.pages.flatMap((page) => page.data) ?? [];
const nextPageParam = <T,>(last: Page<T>) => last.nextCursor ?? undefined;

export const useItemsPages = (params: Omit<ItemsQuery, 'cursor'> = {}, enabled = true) =>
  useInfiniteQuery({ queryKey: [...keys.items, 'pages', params], queryFn: ({ pageParam }) => api.items({ ...params, cursor: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: nextPageParam, enabled });
/** Una sola página (buscadores, listas cortas como "bajo stock"). */
export const useItemsQuery = (params: Omit<ItemsQuery, 'cursor'>, enabled = true) => useQuery({ queryKey: [...keys.items, 'one-page', params], queryFn: () => api.items(params), enabled });
/** Conjunto COMPLETO que cumple el filtro (configuraciones de servicios, agenda); recorre las páginas de 100 en 100. */
export const useAllItems = (params: Omit<ItemsQuery, 'cursor' | 'limit'> = {}, enabled = true) =>
  useQuery({ queryKey: [...keys.items, 'all', params], queryFn: () => fetchAllPages((cursor) => api.items({ ...params, limit: 100, cursor })), enabled });
export const useItemsSummary = (enabled = true) => useQuery({ queryKey: [...keys.items, 'summary'], queryFn: api.itemsSummary, enabled });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: api.categories });
export const useClientsPages = (params: Omit<ClientsQuery, 'cursor'> = {}, enabled = true) =>
  useInfiniteQuery({ queryKey: [...keys.clients, 'pages', params], queryFn: ({ pageParam }) => api.clients({ ...params, cursor: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: nextPageParam, enabled });
/** Buscador de clientes (venta, cita, búsqueda global): primera página con la búsqueda en el servidor. */
export const useClientSearch = (q: string, enabled = true, limit = 20) => useQuery({ queryKey: [...keys.clients, 'search', q, limit], queryFn: () => api.clients({ q: q || undefined, limit }), enabled });
/** Los últimos clientes creados (actividad reciente del Inicio). */
export const useRecentClients = (limit: number, enabled = true) => useQuery({ queryKey: [...keys.clients, 'recent', limit], queryFn: () => api.clients({ sort: 'recent', limit }), enabled });
export const useClientsSummary = (range?: { from: string; to: string }, enabled = true) => useQuery({ queryKey: [...keys.clients, 'summary', range?.from ?? '', range?.to ?? ''], queryFn: () => api.clientsSummary(range), enabled });
/** La caja es solo del dueño: para un empleado la consulta no se hace (el servidor respondería 403). */
export const useCashToday = (enabled = true) => useQuery({ queryKey: keys.cash, queryFn: api.cashToday, enabled });
/** Bases de caja de un rango de días LOCALES ("YYYY-MM-DD", no instantes ISO — ver `api.cashOpenings`), para Reportes. */
export const useCashOpenings = (range: { from: string; to: string } | null, enabled = true) => useQuery({ queryKey: [...keys.cash, 'range', range?.from, range?.to], queryFn: () => api.cashOpenings(range!), enabled: enabled && range !== null, staleTime: 15_000 });
/**
 * Se revisa solo (sin refetch agresivo): el estado real vive en el backend y llega también por push/otras pantallas.
 * `enabled` por defecto en `true` para las pantallas ya protegidas por sesión (paywall, Ajustes); SubscriptionGate
 * SÍ lo pasa en `false` mientras no haya sesión (vive en el shell, montado también en pantallas sin iniciar sesión) —
 * sin esto, un 401 ahí dispara signOut() → se limpia la caché de React Query → esta consulta se repite sin parar.
 */
export const useSubscription = (enabled = true) => useQuery({ queryKey: keys.subscription, queryFn: api.subscription, staleTime: 60_000, enabled });
export function useInvalidateSubscription() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.subscription });
}
/** Historial de Pagos (Mi Suscripción): solo el dueño la pide (el servidor la rechazaría para un empleado). */
export const useSubscriptionInvoices = (enabled = true) => useQuery({ queryKey: keys.subscriptionInvoices, queryFn: api.subscriptionInvoices, staleTime: 60_000, enabled });

/** Un artículo por id (antes descargaba el catálogo entero para buscarlo). */
export function useItem(id: string | undefined) {
  return useQuery({ queryKey: [...keys.items, 'one', id], queryFn: () => api.item(id!), enabled: !!id });
}

export function useClient(id: string | undefined) {
  return useQuery({ queryKey: [...keys.clients, 'one', id], queryFn: () => api.client(id!), enabled: !!id });
}

/** Artículos y categorías comparten conteos: se refrescan juntos. */
export function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.items }), queryClient.invalidateQueries({ queryKey: keys.categories })]);
}

export function useInvalidateClients() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.clients });
}

export const useLoyaltyProgram = (enabled = true) => useQuery({ queryKey: keys.loyaltyProgram, queryFn: api.loyaltyProgram, enabled });
export const useLoyaltySummary = (enabled = true) => useQuery({ queryKey: [...keys.loyaltyClients, 'summary'], queryFn: api.loyaltySummary, enabled });
export const useLoyaltyClients = (q = '', enabled = true) =>
  useInfiniteQuery({ queryKey: [...keys.loyaltyClients, q], queryFn: ({ pageParam }) => api.loyaltyClients({ q: q || undefined, cursor: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: nextPageParam, enabled });
export const useLoyaltyRedemptions = (clientId?: string, enabled = true) =>
  useInfiniteQuery({ queryKey: [...keys.loyaltyRedemptions, clientId ?? ''], queryFn: ({ pageParam }) => api.loyaltyRedemptions({ clientId, cursor: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: nextPageParam, enabled });
/** Historial de servicios (de un cliente o del negocio), paginado. */
export const useServiceRecordsPages = (clientId?: string, enabled = true) =>
  useInfiniteQuery({ queryKey: [...keys.serviceRecords, 'pages', clientId ?? ''], queryFn: ({ pageParam }) => api.serviceRecords({ clientId, cursor: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: nextPageParam, enabled });
/** Visitas de los clientes visibles (columnas "Servicios" y "Último servicio" del directorio web). */
export const useClientVisits = (clientIds: string[], enabled = true) =>
  useQuery({ queryKey: [...keys.serviceRecords, 'by-client', clientIds.join(',')], queryFn: () => api.serviceRecordsByClient(clientIds), enabled: enabled && clientIds.length > 0 });
/** Los últimos servicios registrados (actividad reciente del Inicio). */
export const useRecentServiceRecords = (limit: number, enabled = true) => useQuery({ queryKey: [...keys.serviceRecords, 'recent', limit], queryFn: () => api.serviceRecords({ limit }), enabled });
/** Cantidad, total, promedio, último y más pedido, sin descargar el historial (de un cliente y/o un rango). */
export const useServiceRecordsSummary = (params: { clientId?: string; kind?: 'service' | 'product'; from?: string; to?: string }, enabled = true) =>
  useQuery({ queryKey: [...keys.serviceRecords, 'summary', params.clientId ?? '', params.kind ?? '', params.from ?? '', params.to ?? ''], queryFn: () => api.serviceRecordsSummary(params), enabled });

/** Ventas de un rango (ISO UTC), pensado para "hoy": se refresca cada poco para que una venta recién registrada aparezca sin recargar. */
export const useSales = (range: { from: string; to: string } | null, enabled = true) => useQuery({ queryKey: [...keys.sales, range?.from, range?.to], queryFn: () => api.sales(range!), enabled: enabled && range !== null, staleTime: 15_000 });
export function useInvalidateSales() {
  const queryClient = useQueryClient();
  // Anular una venta repone stock: se refresca también el inventario.
  return (alsoItems = false) => Promise.all([queryClient.invalidateQueries({ queryKey: keys.sales }), ...(alsoItems ? [queryClient.invalidateQueries({ queryKey: keys.items })] : [])]);
}

/**
 * Registrar una venta toca: la propia lista de ventas, el stock de los productos vendidos, los registros de servicio
 * (Inicio y Reportes se alimentan de ahí) y, si hubo sello, la fidelización. Un solo lugar para no olvidar ninguno.
 */
export function useInvalidateAfterSale() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.sales }),
      queryClient.invalidateQueries({ queryKey: keys.items }),
      queryClient.invalidateQueries({ queryKey: keys.serviceRecords }),
      queryClient.invalidateQueries({ queryKey: keys.loyaltyClients }),
      queryClient.invalidateQueries({ queryKey: keys.clients }),
      queryClient.invalidateQueries({ queryKey: keys.categories }),
      queryClient.invalidateQueries({ queryKey: keys.cashCloseSummary }),
    ]);
}

/* ---------- Gastos y cierre de caja ---------- */

export const useExpenses = (range: { from: string; to: string } | null, enabled = true) => useQuery({ queryKey: [...keys.expenses, range?.from, range?.to], queryFn: () => api.expenses(range!.from, range!.to), enabled: enabled && range !== null });
export const useCashCloseSummary = (day: string | null, enabled = true) => useQuery({ queryKey: [...keys.cashCloseSummary, day], queryFn: () => api.cashCloseSummary(day!), enabled: enabled && day !== null });
export const useCashClosings = (range: { from: string; to: string } | null, enabled = true) => useQuery({ queryKey: [...keys.cashClosings, range?.from, range?.to], queryFn: () => api.cashClosings(range!.from, range!.to), enabled: enabled && range !== null });
/** Un cierre puntual, con el resumen del día ya recalculado (`summary`) — para verlo cerrado, no para la lista. */
export const useCashClosingDetail = (id: string | null, enabled = true) => useQuery({ queryKey: [...keys.cashClosings, 'detail', id], queryFn: () => api.cashClosing(id!), enabled: enabled && id !== null });

export function useInvalidateCash() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.cash }),
      queryClient.invalidateQueries({ queryKey: keys.expenses }),
      queryClient.invalidateQueries({ queryKey: keys.cashCloseSummary }),
      queryClient.invalidateQueries({ queryKey: keys.cashClosings }),
    ]);
}

export const useEmployees = (enabled = true) => useQuery({ queryKey: keys.employees, queryFn: api.employees, enabled });
export const useAuditLogs = (enabled = true) => useQuery({ queryKey: keys.auditLogs, queryFn: () => api.auditLogs(), enabled });
export const useNotificationSettings = () => useQuery({ queryKey: keys.notificationSettings, queryFn: api.notificationSettings });

/**
 * Centro de notificaciones (backend): citas, reseñas, fidelización y facturación — ver push.ts. Se revisa cada poco
 * y al volver a la pestaña/pantalla para que un aviso dirigido a otra persona (p. ej. el profesional de una cita que
 * agendó el dueño) aparezca sin depender de que esa persona recargue la página.
 */
export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: api.notifications, staleTime: 15_000, refetchInterval: 45_000 });

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.markNotificationRead(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notifications }) });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => api.markAllNotificationsRead(), onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notifications }) });
}

/** Config, progreso y canjes se invalidan juntos: registrar un servicio o canjear un premio puede cambiar los tres a la vez. */
export function useInvalidateLoyalty() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.loyaltyProgram }),
      queryClient.invalidateQueries({ queryKey: keys.loyaltyClients }),
      queryClient.invalidateQueries({ queryKey: keys.loyaltyRedemptions }),
      queryClient.invalidateQueries({ queryKey: keys.serviceRecords }),
    ]);
}

/* ---------- Citas y página pública ---------- */

/** Citas de un rango (ISO UTC). Se refrescan al volver a la pantalla: otra persona del equipo o un cliente pudo reservar. */
export const useAppointments = (range: { from: string; to: string; professionalId?: string } | null, enabled = true) =>
  useQuery({ queryKey: [...keys.appointments, range?.from, range?.to, range?.professionalId ?? ''], queryFn: () => api.appointments(range!), enabled: enabled && range !== null, staleTime: 15_000 });
export const useProfessionals = (enabled = true) => useQuery({ queryKey: keys.professionals, queryFn: api.professionals, enabled });
export const useBookingSettings = (enabled = true) => useQuery({ queryKey: keys.bookingSettings, queryFn: api.bookingSettings, enabled });
export const useClosures = (enabled = true) => useQuery({ queryKey: keys.closures, queryFn: api.closures, enabled });
export const useBookingReviews = (enabled = true) =>
  useInfiniteQuery({ queryKey: keys.bookingReviews, queryFn: ({ pageParam }) => api.bookingReviews({ cursor: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: nextPageParam, enabled });
export const usePackages = (enabled = true) => useQuery({ queryKey: keys.packages, queryFn: api.packages, enabled });
export const useVariants = (itemId: string | undefined) => useQuery({ queryKey: [...keys.variants, itemId], queryFn: () => api.variants(itemId!), enabled: Boolean(itemId) });
/** Artículos sin confirmar como servicio o producto (solo quien gestiona el catálogo). */
export const useClassification = (enabled = true) => useQuery({ queryKey: keys.classification, queryFn: () => api.classification(), enabled });

/** ¿El servidor tiene Google configurado? y, para el mapa interactivo de la web, la clave del navegador. */
export const usePlacesConfig = () => useQuery({ queryKey: keys.placesConfig, queryFn: api.placesConfig, staleTime: 5 * 60_000 });

export function useInvalidateAppointments() {
  const queryClient = useQueryClient();
  // Cerrar una cita cobra servicios, suma sellos y descuenta productos: se refrescan también esos datos.
  return (alsoBusiness = false) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.appointments }),
      ...(alsoBusiness ? [queryClient.invalidateQueries({ queryKey: keys.items }), queryClient.invalidateQueries({ queryKey: keys.serviceRecords }), queryClient.invalidateQueries({ queryKey: keys.loyaltyClients }), queryClient.invalidateQueries({ queryKey: keys.clients })] : []),
    ]);
}

export function useInvalidateBooking() {
  const queryClient = useQueryClient();
  return () => Promise.all([keys.bookingSettings, keys.professionals, keys.closures, keys.bookingReviews, keys.packages, keys.variants, keys.classification].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

/* ---------- Mensajes (chat interno del equipo) ---------- */

export const useMessagePeople = (enabled = true) => useQuery({ queryKey: keys.messagePeople, queryFn: api.messagePeople, enabled, staleTime: 60_000 });
/** Sin sondeo agresivo: se refresca sola al volver a la pestaña (comportamiento por defecto de React Query) y tras cada acción. */
export const useConversations = (enabled = true) => useQuery({ queryKey: keys.conversations, queryFn: api.conversations, enabled });
/**
 * El hilo abierto sí se revisa cada pocos segundos: sin esto, la otra persona escribiendo no aparecería hasta recargar.
 * No es tan inmediato como el bus de tiempo real que ya usa la Agenda; para un chat interno de equipo alcanza.
 */
export const useConversationMessages = (id: string | null) => useQuery({ queryKey: [...keys.conversationMessages, id], queryFn: () => api.conversationMessages(id!), enabled: Boolean(id), refetchInterval: id ? 4_000 : false });

export function useInvalidateMessages() {
  const queryClient = useQueryClient();
  return (conversationId?: string) =>
    Promise.all([queryClient.invalidateQueries({ queryKey: keys.conversations }), conversationId ? queryClient.invalidateQueries({ queryKey: [...keys.conversationMessages, conversationId] }) : Promise.resolve()]);
}
