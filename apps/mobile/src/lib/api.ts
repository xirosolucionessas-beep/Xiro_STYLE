import type {
  ApiErrorBody,
  AuthSession,
  Business,
  BusinessUpdateInput,
  CashOpening,
  Category,
  Client,
  ClientInput,
  AuditLogEntry,
  Employee,
  EmployeeCreateInput,
  EmployeeUpdateInput,
  Item,
  ItemInput,
  LoginInput,
  LoyaltyClientProgress,
  LoyaltyProgram,
  LoyaltyProgramUpdateInput,
  LoyaltyRedemption,
  NotificationSettings,
  NotificationSettingsUpdateInput,
  PushRegisterInput,
  RecoveryChannel,
  RegisterInput,
  ServiceRecord,
  ServiceRecordInput,
  Subscription,
  SubscriptionPlan,
  SubscriptionPlatform,
  User,
} from '@xiro/shared';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues: Array<{ path: string; message: string }> = [],
  ) {
    super(code);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export function apiBaseUrl(): string {
  if (Platform.OS === 'web') {
    // La Web siempre detecta su propia URL: un EXPO_PUBLIC_API_URL puesto para el celular (IP de LAN, modo túnel…)
    // rompería el CSP connect-src 'self' de la Web al apuntar a un origen distinto del que la sirve.
    const { hostname, port, origin } = window.location;
    // Servidor de desarrollo de Expo (8081) → API local en 3000. En producción la API sirve la web (mismo origen).
    return port === '8081' ? `http://${hostname}:3000` : origin;
  }
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://10.0.2.2:3000';
}

/** URL base pública para enlaces compartidos con clientes. */
export function publicBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_PUBLIC_URL ?? apiBaseUrl()).replace(/\/$/, '');
}

export function resolveMedia(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${apiBaseUrl()}${url}` : url;
}

/* ---------- Estado de sesión que usa el cliente HTTP ---------- */

interface SessionHooks {
  getRefreshToken: () => string | null;
  onTokens: (session: AuthSession) => void;
  onSignedOut: () => void;
}

let accessToken: string | null = null;
let hooks: SessionHooks | null = null;
let refreshing: Promise<boolean> | null = null;

export function configureSession(next: SessionHooks | null) {
  hooks = next;
}
export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function rawRequest(path: string, init: RequestInit & { auth: boolean }): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.auth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  try {
    return await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'offline_error');
  }
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = hooks?.getRefreshToken();
  if (!hooks || !refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const response = await rawRequest('/api/auth/refresh', {
        method: 'POST',
        auth: false,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      hooks?.onTokens((await response.json()) as AuthSession);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function toError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(response.status, body?.code ?? 'unknown_error', body?.issues);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  auth?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const auth = options.auth ?? true;
  const init = (): RequestInit & { auth: boolean } => ({
    method: options.method ?? 'GET',
    auth,
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  let response = await rawRequest(path, init());
  if (response.status === 401 && auth) {
    if (await tryRefresh()) response = await rawRequest(path, init());
    else hooks?.onSignedOut();
  }
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ---------- Endpoints ---------- */

export const api = {
  register: (body: RegisterInput) => request<AuthSession>('/api/auth/register', { method: 'POST', body, auth: false }),
  login: (body: LoginInput) => request<AuthSession>('/api/auth/login', { method: 'POST', body, auth: false }),
  refresh: (refreshToken: string) => request<AuthSession>('/api/auth/refresh', { method: 'POST', body: { refreshToken }, auth: false }),
  logout: (refreshToken: string) => request<void>('/api/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }),
  recoverRequest: (identifier: string, channel: RecoveryChannel) =>
    request<{ ok: true; devCode?: string }>('/api/auth/recover/request', { method: 'POST', body: { identifier, channel }, auth: false }),
  recoverVerify: (identifier: string, code: string) =>
    request<{ resetToken: string }>('/api/auth/recover/verify', { method: 'POST', body: { identifier, code }, auth: false }),
  recoverReset: (resetToken: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/recover/reset', { method: 'POST', body: { resetToken, newPassword }, auth: false }),

  me: () => request<{ user: User; business: Business }>('/api/me'),
  updateMe: (body: Partial<Pick<User, 'name' | 'language' | 'theme'>>) => request<User>('/api/me', { method: 'PATCH', body }),
  requestPhoneChange: (phone: string) => request<{ ok: true; devCode?: string }>('/api/me/phone/request', { method: 'POST', body: { phone } }),
  confirmPhoneChange: (code: string) => request<User>('/api/me/phone/confirm', { method: 'POST', body: { code } }),
  updateBusiness: (body: BusinessUpdateInput) => request<Business>('/api/business', { method: 'PATCH', body }),
  uploadLogo: (form: FormData) => request<Business>('/api/business/logo', { method: 'PUT', form }),
  cashToday: () => request<{ opening: CashOpening | null }>('/api/cash/today'),
  openCash: (body: { amount: number; note?: string }) => request<{ opening: CashOpening }>('/api/cash/opening', { method: 'POST', body }),

  categories: () => request<Category[]>('/api/categories'),
  addCategory: (name: string) => request<Category>('/api/categories', { method: 'POST', body: { name } }),
  renameCategory: (id: string, name: string) => request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: { name } }),
  deleteCategory: (id: string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),

  items: () => request<Item[]>('/api/items'),
  item: (id: string) => request<Item>(`/api/items/${id}`),
  createItem: (body: ItemInput) => request<Item>('/api/items', { method: 'POST', body }),
  updateItem: (id: string, body: ItemInput) => request<Item>(`/api/items/${id}`, { method: 'PUT', body }),
  deleteItem: (id: string) => request<void>(`/api/items/${id}`, { method: 'DELETE' }),
  addPhoto: (id: string, form: FormData) => request<Item>(`/api/items/${id}/photos`, { method: 'POST', form }),
  deletePhoto: (id: string, photoId: string) => request<Item>(`/api/items/${id}/photos/${photoId}`, { method: 'DELETE' }),
  makePrimaryPhoto: (id: string, photoId: string) => request<Item>(`/api/items/${id}/photos/${photoId}/primary`, { method: 'POST' }),

  clients: (q?: string) => request<Client[]>(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  client: (id: string) => request<Client>(`/api/clients/${id}`),
  createClient: (body: ClientInput) => request<Client>('/api/clients', { method: 'POST', body }),
  updateClient: (id: string, body: ClientInput) => request<Client>(`/api/clients/${id}`, { method: 'PUT', body }),
  deleteClient: (id: string) => request<void>(`/api/clients/${id}`, { method: 'DELETE' }),

  loyaltyProgram: () => request<LoyaltyProgram>('/api/loyalty/program'),
  updateLoyaltyProgram: (body: LoyaltyProgramUpdateInput) => request<LoyaltyProgram>('/api/loyalty/program', { method: 'PUT', body }),
  loyaltyClients: () => request<LoyaltyClientProgress[]>('/api/loyalty/clients'),
  loyaltyRedemptions: (clientId?: string) => request<LoyaltyRedemption[]>(`/api/loyalty/redemptions${clientId ? `?clientId=${clientId}` : ''}`),
  redeemLoyalty: (clientId: string) => request<LoyaltyClientProgress>(`/api/loyalty/clients/${clientId}/redeem`, { method: 'POST' }),
  serviceRecords: (clientId?: string) => request<ServiceRecord[]>(`/api/service-records${clientId ? `?clientId=${clientId}` : ''}`),
  createServiceRecord: (body: ServiceRecordInput) => request<ServiceRecord & { rewardJustEarned: boolean }>('/api/service-records', { method: 'POST', body }),

  notificationSettings: () => request<NotificationSettings>('/api/notifications/settings'),
  updateNotificationSettings: (body: NotificationSettingsUpdateInput) => request<NotificationSettings>('/api/notifications/settings', { method: 'PUT', body }),
  vapidPublicKey: () => request<{ publicKey: string | null }>('/api/notifications/vapid-public-key'),
  registerPush: (body: PushRegisterInput) => request<{ ok: true }>('/api/notifications/register', { method: 'POST', body }),
  unregisterPush: (token: string) => request<{ ok: true }>('/api/notifications/register', { method: 'DELETE', body: { token } }),
  sendTestNotification: () => request<{ sent: number; pruned: number }>('/api/notifications/test', { method: 'POST' }),

  employees: () => request<Employee[]>('/api/employees'),
  createEmployee: (body: EmployeeCreateInput) => request<Employee>('/api/employees', { method: 'POST', body }),
  updateEmployee: (id: string, body: EmployeeUpdateInput) => request<Employee>(`/api/employees/${id}`, { method: 'PATCH', body }),
  auditLogs: (userId?: string) => request<AuditLogEntry[]>(`/api/audit-logs${userId ? `?userId=${userId}` : ''}`),

  subscription: () => request<Subscription>('/api/subscription'),
  startTrial: (plan: SubscriptionPlan, platform: SubscriptionPlatform) => request<Subscription>('/api/subscription/trial', { method: 'POST', body: { plan, platform } }),
  cancelSubscription: () => request<Subscription>('/api/subscription/cancel', { method: 'POST' }),
  checkoutStripe: (plan: SubscriptionPlan) => request<{ url: string }>('/api/subscription/checkout/stripe', { method: 'POST', body: { plan } }),
  checkoutPaypal: (plan: SubscriptionPlan) => request<{ url: string }>('/api/subscription/checkout/paypal', { method: 'POST', body: { plan } }),
  checkoutBankTransfer: (plan: SubscriptionPlan) => request<{ instructions: string; plan: SubscriptionPlan }>('/api/subscription/checkout/bank-transfer', { method: 'POST', body: { plan } }),
};

/** Traduce un error de API a una clave de i18n (o el mensaje del primer campo inválido). */
export function errorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetwork) return 'offline_error';
    if (error.code === 'validation_error' && error.issues[0]) return error.issues[0].message;
    return error.code;
  }
  return 'unknown_error';
}

/** Mapa campo → clave de i18n para mostrar errores junto a cada input. */
export function fieldErrors(error: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (error instanceof ApiError) {
    for (const issue of error.issues) {
      const field = issue.path.split('.')[0] ?? '';
      if (field && !result[field]) result[field] = issue.message;
    }
  }
  return result;
}
