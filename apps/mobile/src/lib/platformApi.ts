import type {
  AccessGrantDto,
  PlatformAdminDto,
  PlatformAuditEntryDto,
  PlatformBusinessDetail,
  PlatformGrantInput,
  PlatformGrouping,
  PlatformOverview,
  PlatformSearchKind,
  PlatformSearchResult,
  PlatformSeries,
  PlatformSeriesDto,
  PlatformSessionDto,
} from '@xiro/shared';
import { useSyncExternalStore } from 'react';
import { apiBaseUrl, ApiError } from './api';

/**
 * Cliente del panel de plataforma (fundador). Totalmente aparte del cliente de negocios (lib/api.ts): otro token, sin
 * renovación automática y SOLO en memoria — ni localStorage, ni cookies, ni Keychain. Recargar la página o cerrar la app
 * obliga a iniciar sesión otra vez (con contraseña y código TOTP): a propósito, es una sesión privilegiada.
 */
interface State {
  token: string | null;
  admin: PlatformAdminDto | null;
  expiresAt: string | null;
}

let state: State = { token: null, admin: null, expiresAt: null };
const listeners = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
};

export function usePlatformSession(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export const platformSignedOut = () => emit({ token: null, admin: null, expiresAt: null });
export const hasPermission = (admin: PlatformAdminDto | null, permission: string) => Boolean(admin && (admin.isFounder || admin.permissions.includes(permission as never)));

const TIMEOUT_MS = 20_000;

async function call<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    // Sin reintentos automáticos: las acciones del panel no deben repetirse solas (las concesiones además son idempotentes).
    response = await fetch(`${apiBaseUrl()}/api/platform${path}`, { method: init.method ?? 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: controller.signal });
  } catch {
    throw new ApiError(0, controller.signal.aborted ? 'timeout_error' : 'offline_error');
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 && init.auth !== false) platformSignedOut();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; issues?: Array<{ path: string; message: string }> } | null;
    throw new ApiError(response.status, body?.code ?? 'unknown_error', body?.issues ?? []);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};

export interface PeriodParams {
  from?: string;
  to?: string;
  tz?: string;
}

export const platformApi = {
  async login(email: string, password: string, totp: string): Promise<void> {
    const session = await call<PlatformSessionDto>('/auth/login', { method: 'POST', body: { email, password, totp }, auth: false });
    emit({ token: session.token, admin: session.admin, expiresAt: session.expiresAt });
  },
  async logout(): Promise<void> {
    try {
      await call('/auth/logout', { method: 'POST' });
    } finally {
      platformSignedOut();
    }
  },
  stepUp: (totp: string) => call<{ mfaAt: string }>('/auth/step-up', { method: 'POST', body: { totp } }),
  overview: (p: PeriodParams) => call<PlatformOverview>(`/metrics/overview${qs({ ...p })}`),
  series: (metric: PlatformSeries, grouping: PlatformGrouping, p: PeriodParams) => call<PlatformSeriesDto>(`/metrics/series${qs({ metric, grouping, ...p })}`),
  search: (kind: PlatformSearchKind, q: string) => call<PlatformSearchResult>(`/businesses/search${qs({ kind, q })}`),
  business: (id: string) => call<PlatformBusinessDetail>(`/businesses/${encodeURIComponent(id)}`),
  changeStatus: (id: string, action: 'suspend' | 'reactivate' | 'deactivate' | 'restore', body: { reason: string; confirmSlug: string }) =>
    call<{ from: string; to: string; sessionsRevoked: number }>(`/businesses/${encodeURIComponent(id)}/${action}`, { method: 'POST', body }),
  grant: (id: string, body: PlatformGrantInput) => call<{ grant: AccessGrantDto; replayed: boolean }>(`/businesses/${encodeURIComponent(id)}/grants`, { method: 'POST', body }),
  revokeGrant: (id: string, grantId: string, reason: string) => call<void>(`/businesses/${encodeURIComponent(id)}/grants/${encodeURIComponent(grantId)}/revoke`, { method: 'POST', body: { reason } }),
  audit: (before?: string) => call<{ entries: PlatformAuditEntryDto[]; nextBefore: string | null }>(`/audit${qs({ before })}`),
};
