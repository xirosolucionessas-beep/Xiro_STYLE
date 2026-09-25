import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const keys = {
  items: ['items'] as const,
  categories: ['categories'] as const,
  clients: ['clients'] as const,
  cash: ['cash'] as const,
  subscription: ['subscription'] as const,
  loyaltyProgram: ['loyaltyProgram'] as const,
  loyaltyClients: ['loyaltyClients'] as const,
  loyaltyRedemptions: ['loyaltyRedemptions'] as const,
  serviceRecords: ['serviceRecords'] as const,
  notificationSettings: ['notificationSettings'] as const,
  employees: ['employees'] as const,
  auditLogs: ['auditLogs'] as const,
};

export const useItems = (enabled = true) => useQuery({ queryKey: keys.items, queryFn: api.items, enabled });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: api.categories });
export const useClients = (q = '', enabled = true) => useQuery({ queryKey: [...keys.clients, q], queryFn: () => api.clients(q || undefined), enabled });
/** La caja es solo del dueño: para un empleado la consulta no se hace (el servidor respondería 403). */
export const useCashToday = (enabled = true) => useQuery({ queryKey: keys.cash, queryFn: api.cashToday, enabled });
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

export function useItem(id: string | undefined) {
  const items = useItems();
  return { ...items, data: items.data?.find((item) => item.id === id) };
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
export const useLoyaltyClients = () => useQuery({ queryKey: keys.loyaltyClients, queryFn: api.loyaltyClients });
export const useLoyaltyRedemptions = (clientId?: string, enabled = true) => useQuery({ queryKey: [...keys.loyaltyRedemptions, clientId ?? ''], queryFn: () => api.loyaltyRedemptions(clientId), enabled });
export const useServiceRecords = (clientId?: string, enabled = true) => useQuery({ queryKey: [...keys.serviceRecords, clientId ?? ''], queryFn: () => api.serviceRecords(clientId), enabled });

export const useEmployees = (enabled = true) => useQuery({ queryKey: keys.employees, queryFn: api.employees, enabled });
export const useAuditLogs = (enabled = true) => useQuery({ queryKey: keys.auditLogs, queryFn: () => api.auditLogs(), enabled });
export const useNotificationSettings = () => useQuery({ queryKey: keys.notificationSettings, queryFn: api.notificationSettings });

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
