import type {
  ApiErrorBody,
  AppointmentDto,
  AppointmentStatus,
  AuthSession,
  AvailabilityResponse,
  BookingAdminSettings,
  BookingSettingsInput,
  ClassificationEntry,
  ClosureDto,
  ConversationDto,
  DaySummary,
  PackageDto,
  PackageInput,
  PickedLocation,
  PlaceSuggestion,
  PlacesConfig,
  ProfessionalDto,
  ProfessionalInput,
  PublicProfileInput,
  ReverseGeocodeResult,
  ReviewDto,
  ScheduleBlock,
  StaffAppointmentInput,
  TimeOffDto,
  VariantDto,
  VariantInput,
  Business,
  BusinessUpdateInput,
  CashClosingDto,
  CashCloseInput,
  CashDaySummary,
  CashOpening,
  CashOpeningDto,
  Category,
  Client,
  ClientInput,
  AuditLogEntry,
  Employee,
  EmployeeCreateInput,
  EmployeeUpdateInput,
  ExpenseDto,
  ExpenseInput,
  Item,
  ItemInput,
  Language,
  LoginInput,
  LoyaltyClientProgress,
  LoyaltyProgram,
  LoyaltyProgramUpdateInput,
  LoyaltyRedemption,
  MessageDto,
  MessagePerson,
  NotificationDto,
  NotificationSettings,
  NotificationSettingsUpdateInput,
  PushRegisterInput,
  RecoveryChannel,
  RegisterInput,
  SaleDto,
  SaleInput,
  ServiceRecord,
  ServiceRecordInput,
  Subscription,
  SubscriptionInvoiceDto,
  SubscriptionPlan,
  SubscriptionPlatform,
  User,
} from '@xiro/shared';
import type { DiscountCodeDto, DiscountCodeInput, WaitlistEntryDto } from '@xiro/shared';
import { HTTP_TIMEOUT_MS, withRetry, type ClientsQuery, type ClientVisits, type ClientsSummary, type ItemsQuery, type ItemsSummary, type LoyaltySummary, type Page, type PageParams, type ProductOrderDto, type ProductOrdersQuery, type ProductOrdersSummary, type ServiceRecordsQuery, type ServiceRecordsSummary } from '@xiro/shared';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues: Array<{ path: string; message: string }> = [],
    /** Campos extra del cuerpo del error (p. ej. `alternatives` en `slot_taken`). */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

/** Host imposible (dominio reservado `.invalid`): una compilación de producción mal configurada falla cerrada. */
export const MISCONFIGURED_API_URL = 'https://api-url-no-configurada.invalid';

/**
 * URL de la API en el celular. En desarrollo, la de EXPO_PUBLIC_API_URL o la IP del PC que sirve Metro (http, red local).
 * En una compilación de PRODUCCIÓN solo vale una URL https: sin ella (o con http://) la app NO cae a http en texto
 * plano —tokens y datos de clientes viajarían sin cifrar—; apunta a un host inválido y cada petición falla.
 */
export function resolveNativeApiUrl(input: { dev: boolean; configured?: string; hostUri?: string | null }): string {
  const configured = input.configured?.trim().replace(/\/$/, '');
  if (!input.dev) return configured && /^https:\/\/[^/]/i.test(configured) ? configured : MISCONFIGURED_API_URL;
  if (configured) return configured;
  const host = input.hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://10.0.2.2:3000';
}

export function apiBaseUrl(): string {
  if (Platform.OS === 'web') {
    // La Web siempre detecta su propia URL: un EXPO_PUBLIC_API_URL puesto para el celular (IP de LAN, modo túnel…)
    // rompería el CSP connect-src 'self' de la Web al apuntar a un origen distinto del que la sirve.
    const { hostname, port, origin } = window.location;
    // Servidor de desarrollo de Expo (8081) → API local en 3000. En producción la API sirve la web (mismo origen).
    return port === '8081' ? `http://${hostname}:3000` : origin;
  }
  return resolveNativeApiUrl({ dev: __DEV__, configured: process.env.EXPO_PUBLIC_API_URL, hostUri: Constants.expoConfig?.hostUri });
}

/** URL base pública para enlaces compartidos con clientes. */
export function publicBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_PUBLIC_URL ?? apiBaseUrl()).replace(/\/$/, '');
}

/**
 * Dirección pública CANÓNICA de un servicio o producto (Fase 2): la página de reservas moderna con su detalle abierto. Si ese
 * artículo no se ve allí (página sin publicar, no reservable…), el servidor lleva solo al catálogo de siempre — la app no
 * necesita saberlo, así que el mismo enlace sirve siempre ("Ver página pública", compartir).
 */
export function publicItemUrl(slug: string, itemId: string): string {
  return `${publicBaseUrl()}/reservar/${encodeURIComponent(slug)}/articulo/${encodeURIComponent(itemId)}`;
}

export function resolveMedia(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('/') ? `${apiBaseUrl()}${url}` : url;
}

/* ---------- Estado de sesión que usa el cliente HTTP ---------- */

interface SessionHooks {
  getRefreshToken: () => string | null;
  /** "Recordarme" (solo web): cookie persistente de 30 días o de sesión del navegador. */
  remembers?: () => boolean;
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

/**
 * Un intento con tiempo máximo (`HTTP_TIMEOUT_MS`). Se usa AbortController + setTimeout (no `AbortSignal.timeout`,
 * que no existe en todas las versiones de React Native). Sin respuesta a tiempo = `timeout_error`; sin red = `offline_error`
 * (ambos con status 0: la sesión no se cierra por un problema de red).
 */
async function fetchOnce(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new ApiError(0, controller.signal.aborted ? 'timeout_error' : 'offline_error');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Panel web: el refresh token vive en una cookie HttpOnly que pone la API (JavaScript nunca lo ve, así un XSS no puede
 * robarlo). Las rutas /api/auth se piden con `X-Xiro-Session: cookie` y con credenciales; la app móvil no usa esto
 * (guarda el token en Keychain/Keystore). Ver apps/api/src/routes/auth.ts.
 */
export const usesCookieSession = Platform.OS === 'web';

/** Política común (@xiro/shared/http): solo GET se reintenta (hasta 3 intentos, backoff con jitter) y nunca un 4xx. */
async function rawRequest(path: string, init: RequestInit & { auth: boolean }): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.auth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const { auth: _auth, ...rest } = init;
  const cookieAuth = usesCookieSession && path.startsWith('/api/auth/');
  if (cookieAuth) {
    headers.set('X-Xiro-Session', 'cookie');
    if (hooks?.remembers?.() === false) headers.set('X-Xiro-Remember', '0');
  }
  return withRetry(
    init.method,
    () => fetchOnce(`${apiBaseUrl()}${path}`, { ...rest, headers, ...(cookieAuth ? { credentials: 'include' as const } : {}) }),
    (response) => response.status,
    (error) => error instanceof ApiError && error.isNetwork,
  );
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = hooks?.getRefreshToken();
  // En web el token no está en JavaScript: va en la cookie, así que se intenta igual.
  if (!hooks || (!refreshToken && !usesCookieSession)) return false;
  refreshing ??= (async () => {
    try {
      const response = await rawRequest('/api/auth/refresh', {
        method: 'POST',
        auth: false,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
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
  return new ApiError(response.status, body?.code ?? 'unknown_error', body?.issues, (body ?? {}) as Record<string, unknown>);
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

/** `?a=1&b=x` a partir de un objeto; omite `undefined`, `null` y cadenas vacías. */
function query(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * Recorre TODAS las páginas de un listado (para lo que de verdad necesita el conjunto completo: configuraciones de
 * servicios, el catálogo en PDF). `maxPages` es un tope de seguridad (100 × 100 = 10.000 filas).
 */
export async function fetchAllPages<T>(fetchPage: (cursor: string | undefined) => Promise<Page<T>>, maxPages = 100): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    all.push(...result.data);
    if (!result.nextCursor) return all;
    cursor = result.nextCursor;
  }
  return all;
}

/* ---------- Endpoints ---------- */

export const api = {
  register: (body: RegisterInput) => request<AuthSession>('/api/auth/register', { method: 'POST', body, auth: false }),
  login: (body: LoginInput) => request<AuthSession>('/api/auth/login', { method: 'POST', body, auth: false }),
  /** Sin token = la cookie HttpOnly del panel web (ver `usesCookieSession`). */
  refresh: (refreshToken?: string | null) => request<AuthSession>('/api/auth/refresh', { method: 'POST', body: refreshToken ? { refreshToken } : {}, auth: false }),
  logout: (refreshToken?: string | null) => request<void>('/api/auth/logout', { method: 'POST', body: refreshToken ? { refreshToken } : {}, auth: false }),
  recoverRequest: (identifier: string, channel: RecoveryChannel) =>
    request<{ ok: true; devCode?: string }>('/api/auth/recover/request', { method: 'POST', body: { identifier, channel }, auth: false }),
  recoverVerify: (identifier: string, code: string) =>
    request<{ resetToken: string }>('/api/auth/recover/verify', { method: 'POST', body: { identifier, code }, auth: false }),
  recoverReset: (resetToken: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/recover/reset', { method: 'POST', body: { resetToken, newPassword }, auth: false }),

  me: () => request<{ user: User; business: Business }>('/api/me'),
  updateMe: (body: Partial<Pick<User, 'name' | 'language' | 'theme'>>) => request<User>('/api/me', { method: 'PATCH', body }),
  uploadMyPhoto: (form: FormData) => request<User>('/api/me/photo', { method: 'PUT', form }),
  deleteMyPhoto: () => request<User>('/api/me/photo', { method: 'DELETE' }),

  /* ---------- Mensajes (chat interno del equipo) ---------- */
  messagePeople: () => request<MessagePerson[]>('/api/messages/people'),
  conversations: () => request<ConversationDto[]>('/api/messages/conversations'),
  startConversation: (userId: string) => request<ConversationDto>('/api/messages/conversations', { method: 'POST', body: { userId } }),
  conversationMessages: (id: string) => request<MessageDto[]>(`/api/messages/conversations/${id}/messages`),
  sendMessage: (id: string, content: string) => request<MessageDto>(`/api/messages/conversations/${id}/messages`, { method: 'POST', body: { content } }),
  markConversationRead: (id: string) => request<{ ok: true }>(`/api/messages/conversations/${id}/read`, { method: 'POST' }),

  requestPhoneChange: (phone: string) => request<{ ok: true; devCode?: string }>('/api/me/phone/request', { method: 'POST', body: { phone } }),
  confirmPhoneChange: (code: string) => request<User>('/api/me/phone/confirm', { method: 'POST', body: { code } }),
  updateBusiness: (body: BusinessUpdateInput) => request<Business>('/api/business', { method: 'PATCH', body }),
  uploadLogo: (form: FormData) => request<Business>('/api/business/logo', { method: 'PUT', form }),
  cashToday: () => request<{ opening: CashOpening | null }>('/api/cash/today'),
  openCash: (body: { amount: number; note?: string }) => request<{ opening: CashOpening }>('/api/cash/opening', { method: 'POST', body }),
  /** Bases de caja registradas en un rango (Reportes: tarjeta "Base inicial"); un día sin apertura no aparece en la lista. */
  cashOpenings: (range: { from: string; to: string }) => request<CashOpeningDto[]>(`/api/cash/openings?${new URLSearchParams(range).toString()}`),

  /* ---------- Gastos y cierre de caja ---------- */
  expenses: (from: string, to: string) => request<ExpenseDto[]>(`/api/expenses?${new URLSearchParams({ from, to }).toString()}`),
  createExpense: (body: ExpenseInput) => request<ExpenseDto>('/api/expenses', { method: 'POST', body }),
  cashCloseSummary: (day: string) => request<CashDaySummary>(`/api/cash/close-summary?day=${day}`),
  cashClosings: (from: string, to: string) => request<CashClosingDto[]>(`/api/cash/closings?${new URLSearchParams({ from, to }).toString()}`),
  cashClosing: (id: string) => request<CashClosingDto>(`/api/cash/closings/${id}`),
  closeCash: (body: CashCloseInput) => request<CashClosingDto>('/api/cash/close', { method: 'POST', body }),
  voidCashClosing: (id: string, reason: string) => request<CashClosingDto>(`/api/cash/closings/${id}/void`, { method: 'POST', body: { reason } }),

  categories: () => request<Category[]>('/api/categories'),
  addCategory: (name: string) => request<Category>('/api/categories', { method: 'POST', body: { name } }),
  renameCategory: (id: string, name: string) => request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: { name } }),
  deleteCategory: (id: string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),

  /** Catálogo/inventario paginado (`limit` ≤ 100) con filtros en el servidor. */
  items: (params: ItemsQuery = {}) => request<Page<Item>>(`/api/items${query(params)}`),
  itemsSummary: () => request<ItemsSummary>('/api/items/summary'),
  item: (id: string) => request<Item>(`/api/items/${id}`),
  createItem: (body: ItemInput) => request<Item>('/api/items', { method: 'POST', body }),
  updateItem: (id: string, body: ItemInput) => request<Item>(`/api/items/${id}`, { method: 'PUT', body }),
  deleteItem: (id: string) => request<void>(`/api/items/${id}`, { method: 'DELETE' }),
  bulkPublish: (ids: string[], published: boolean) => request<{ updated: number }>('/api/items/bulk-publish', { method: 'POST', body: { ids, published } }),
  addPhoto: (id: string, form: FormData) => request<Item>(`/api/items/${id}/photos`, { method: 'POST', form }),
  deletePhoto: (id: string, photoId: string) => request<Item>(`/api/items/${id}/photos/${photoId}`, { method: 'DELETE' }),
  makePrimaryPhoto: (id: string, photoId: string) => request<Item>(`/api/items/${id}/photos/${photoId}/primary`, { method: 'POST' }),

  /** Directorio paginado (`limit` ≤ 100): `q` busca en el servidor; `sort=recent` = los últimos creados primero. */
  clients: (params: ClientsQuery = {}) => request<Page<Client>>(`/api/clients${query(params)}`),
  clientsSummary: (range?: { from: string; to: string }) => request<ClientsSummary>(`/api/clients/summary${query(range ?? {})}`),
  client: (id: string) => request<Client>(`/api/clients/${id}`),
  createClient: (body: ClientInput) => request<Client>('/api/clients', { method: 'POST', body }),
  updateClient: (id: string, body: ClientInput) => request<Client>(`/api/clients/${id}`, { method: 'PUT', body }),
  deleteClient: (id: string) => request<void>(`/api/clients/${id}`, { method: 'DELETE' }),
  /** Derecho de supresión (Ley 1581): borra los datos identificables del cliente; conserva sus citas y servicios como historial. */
  anonymizeClient: (id: string) => request<Client>(`/api/clients/${id}/anonymize`, { method: 'POST' }),
  /** Foto opcional del cliente (100% opcional): sin ella, la UI muestra un avatar con sus iniciales. */
  uploadClientPhoto: (id: string, form: FormData) => request<Client>(`/api/clients/${id}/photo`, { method: 'PUT', form }),
  deleteClientPhoto: (id: string) => request<Client>(`/api/clients/${id}/photo`, { method: 'DELETE' }),

  loyaltyProgram: () => request<LoyaltyProgram>('/api/loyalty/program'),
  updateLoyaltyProgram: (body: LoyaltyProgramUpdateInput) => request<LoyaltyProgram>('/api/loyalty/program', { method: 'PUT', body }),
  loyaltySummary: () => request<LoyaltySummary>('/api/loyalty/summary'),
  loyaltyClients: (params: PageParams & { q?: string } = {}) => request<Page<LoyaltyClientProgress>>(`/api/loyalty/clients${query(params)}`),
  loyaltyRedemptions: (params: PageParams & { clientId?: string } = {}) => request<Page<LoyaltyRedemption>>(`/api/loyalty/redemptions${query(params)}`),
  redeemLoyalty: (clientId: string) => request<LoyaltyClientProgress>(`/api/loyalty/clients/${clientId}/redeem`, { method: 'POST' }),
  serviceRecords: (params: ServiceRecordsQuery = {}) => request<Page<ServiceRecord>>(`/api/service-records${query(params)}`),
  serviceRecordsByClient: (clientIds: string[]) => request<ClientVisits[]>(`/api/service-records/by-client${query({ clientIds: clientIds.join(',') })}`),
  serviceRecordsSummary: (params: { clientId?: string; kind?: 'service' | 'product'; from?: string; to?: string } = {}) => request<ServiceRecordsSummary>(`/api/service-records/summary${query(params)}`),
  createServiceRecord: (body: ServiceRecordInput) => request<ServiceRecord & { rewardJustEarned: boolean }>('/api/service-records', { method: 'POST', body }),

  /* ---------- Ventas (POS) ---------- */
  // limit=200 (el máximo que acepta el servidor): un rango largo (mes/año, para Reportes) no debe cortarse antes de tiempo.
  sales: (query: { from: string; to: string }) => request<SaleDto[]>(`/api/sales?${new URLSearchParams({ from: query.from, to: query.to, limit: '200' }).toString()}`),
  createSale: (body: SaleInput) => request<SaleDto & { rewardJustEarned: boolean }>('/api/sales', { method: 'POST', body }),
  voidSale: (id: string, reason: string) => request<SaleDto>(`/api/sales/${id}/void`, { method: 'POST', body: { reason } }),
  /* Pedidos de solo productos de la página pública (entregar = registrar la venta con `productOrderId`). */
  orders: (params: ProductOrdersQuery = {}) => request<Page<ProductOrderDto>>(`/api/orders${query(params)}`),
  ordersSummary: () => request<ProductOrdersSummary>('/api/orders/summary'),
  order: (id: string) => request<ProductOrderDto>(`/api/orders/${id}`),
  orderReady: (id: string) => request<ProductOrderDto>(`/api/orders/${id}/ready`, { method: 'POST', body: {} }),
  orderCancel: (id: string, reason = '') => request<ProductOrderDto>(`/api/orders/${id}/cancel`, { method: 'POST', body: { reason } }),

  notificationSettings: () => request<NotificationSettings>('/api/notifications/settings'),
  updateNotificationSettings: (body: NotificationSettingsUpdateInput) => request<NotificationSettings>('/api/notifications/settings', { method: 'PUT', body }),
  vapidPublicKey: () => request<{ publicKey: string | null }>('/api/notifications/vapid-public-key'),
  registerPush: (body: PushRegisterInput) => request<{ ok: true }>('/api/notifications/register', { method: 'POST', body }),
  unregisterPush: (token: string) => request<{ ok: true }>('/api/notifications/register', { method: 'DELETE', body: { token } }),
  sendTestNotification: () => request<{ sent: number; pruned: number }>('/api/notifications/test', { method: 'POST' }),
  notifications: () => request<{ notifications: NotificationDto[]; unread: number }>('/api/notifications'),
  markNotificationRead: (id: string) => request<NotificationDto>(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request<{ ok: true }>('/api/notifications/read-all', { method: 'POST' }),

  employees: () => request<Employee[]>('/api/employees'),
  createEmployee: (body: EmployeeCreateInput) => request<Employee>('/api/employees', { method: 'POST', body }),
  updateEmployee: (id: string, body: EmployeeUpdateInput) => request<Employee>(`/api/employees/${id}`, { method: 'PATCH', body }),
  /** Foto de cuenta de un empleado, puesta por el dueño (misma columna que `/me/photo`: el propio empleado también puede cambiarla). */
  uploadEmployeePhoto: (id: string, form: FormData) => request<Employee>(`/api/employees/${id}/photo`, { method: 'PUT', form }),
  deleteEmployeePhoto: (id: string) => request<Employee>(`/api/employees/${id}/photo`, { method: 'DELETE' }),
  auditLogs: (userId?: string) => request<AuditLogEntry[]>(`/api/audit-logs${userId ? `?userId=${userId}` : ''}`),

  /* ---------- Citas (agenda del personal) ---------- */
  appointments: (query: { from: string; to: string; professionalId?: string; status?: AppointmentStatus }) =>
    request<AppointmentDto[]>(`/api/appointments?${new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => Boolean(e[1]))).toString()}`),
  createAppointment: (body: StaffAppointmentInput) => request<AppointmentDto>('/api/appointments', { method: 'POST', body }),
  updateAppointment: (id: string, body: { startsAt?: string; professionalId?: string; internalNotes?: string; customerNotes?: string }) => request<AppointmentDto>(`/api/appointments/${id}`, { method: 'PATCH', body }),
  setAppointmentStatus: (id: string, status: AppointmentStatus, reason = '') => request<AppointmentDto & { rewardJustEarned?: boolean }>(`/api/appointments/${id}/status`, { method: 'POST', body: { status, reason } }),
  staffAvailability: (query: AvailabilityQuery) => request<AvailabilityResponse>(`/api/booking/availability?${availabilityParams(query)}`),
  staffDays: (query: AvailabilityQuery & { from: string; days: number }) => request<DaySummary[]>(`/api/booking/days?${availabilityParams(query)}`),
  /** Ticket de un solo uso (30s) para abrir el stream de "algo cambió en tus citas" — ver lib/realtime.web.ts. */
  eventsTicket: () => request<{ ticket: string }>('/api/booking/events/ticket', { method: 'POST' }),

  /* ---------- Mi página web ---------- */
  bookingSettings: () => request<BookingAdminSettings>('/api/booking/settings'),
  saveBookingSettings: (body: BookingSettingsInput) => request<BookingAdminSettings>('/api/booking/settings', { method: 'PUT', body }),
  saveBookingProfile: (body: PublicProfileInput) => request<BookingAdminSettings>('/api/booking/profile', { method: 'PUT', body }),
  /* Ubicación del local: todo pasa por el servidor, que es quien tiene la clave de Google (ver booking/google.ts). */
  placesConfig: () => request<PlacesConfig>('/api/booking/places/config'),
  placesAutocomplete: (q: string, session: string, lang: Language) => request<PlaceSuggestion[]>(`/api/booking/places/autocomplete?${new URLSearchParams({ q, session, lang })}`),
  placesDetails: (placeId: string, session: string, lang: Language) => request<PickedLocation>(`/api/booking/places/details?${new URLSearchParams({ placeId, session, lang })}`),
  placesReverse: (lat: number, lng: number, lang: Language) => request<ReverseGeocodeResult>(`/api/booking/places/reverse?${new URLSearchParams({ lat: String(lat), lng: String(lng), lang })}`),
  placesStaticMap: (lat: number, lng: number) => request<{ image: string }>(`/api/booking/places/static-map?${new URLSearchParams({ lat: String(lat), lng: String(lng) })}`),
  uploadBookingCover: (form: FormData) => request<BookingAdminSettings>('/api/booking/profile/cover', { method: 'PUT', form }),
  deleteBookingCover: () => request<BookingAdminSettings>('/api/booking/profile/cover', { method: 'DELETE' }),
  addGalleryPhoto: (form: FormData) => request<BookingAdminSettings>('/api/booking/profile/gallery', { method: 'POST', form }),
  deleteGalleryPhoto: (file: string) => request<BookingAdminSettings>(`/api/booking/profile/gallery/${encodeURIComponent(file)}`, { method: 'DELETE' }),
  checkSlug: (slug: string) => request<{ slug: string; available: boolean; reason?: string }>(`/api/booking/slug/check?slug=${encodeURIComponent(slug)}`),
  saveSlug: (slug: string) => request<{ slug: string }>('/api/booking/slug', { method: 'PUT', body: { slug } }),
  closures: () => request<ClosureDto[]>('/api/booking/closures'),
  addClosure: (body: { date: string; reason: string }) => request<ClosureDto>('/api/booking/closures', { method: 'POST', body }),
  deleteClosure: (id: string) => request<void>(`/api/booking/closures/${id}`, { method: 'DELETE' }),
  bookingReviews: (params: PageParams & { status?: 'pending' | 'approved' | 'hidden' } = {}) => request<Page<ReviewDto>>(`/api/booking/reviews${query(params)}`),
  moderateReview: (id: string, status: 'approved' | 'hidden') => request<ReviewDto>(`/api/booking/reviews/${id}`, { method: 'PATCH', body: { status } }),

  /* ---------- Códigos de descuento y lista de espera (Fase 4) ---------- */
  discountCodes: () => request<DiscountCodeDto[]>('/api/discount-codes'),
  createDiscountCode: (body: DiscountCodeInput) => request<DiscountCodeDto>('/api/discount-codes', { method: 'POST', body }),
  updateDiscountCode: (id: string, body: DiscountCodeInput) => request<DiscountCodeDto>(`/api/discount-codes/${id}`, { method: 'PUT', body }),
  deleteDiscountCode: (id: string) => request<void>(`/api/discount-codes/${id}`, { method: 'DELETE' }),
  waitlist: (params: { from?: string; status?: 'waiting' | 'notified' | 'cancelled' } = {}) => request<WaitlistEntryDto[]>(`/api/waitlist${query(params)}`),
  cancelWaitlistEntry: (id: string) => request<WaitlistEntryDto>(`/api/waitlist/${id}/cancel`, { method: 'POST', body: {} }),

  /* ---------- Profesionales ---------- */
  professionals: () => request<ProfessionalDto[]>('/api/professionals'),
  updateProfessional: (id: string, body: ProfessionalInput) => request<ProfessionalDto>(`/api/professionals/${id}`, { method: 'PATCH', body }),
  uploadProfessionalPhoto: (id: string, form: FormData) => request<ProfessionalDto>(`/api/professionals/${id}/photo`, { method: 'PUT', form }),
  deleteProfessionalPhoto: (id: string) => request<ProfessionalDto>(`/api/professionals/${id}/photo`, { method: 'DELETE' }),
  saveSchedule: (id: string, blocks: ScheduleBlock[]) => request<ProfessionalDto>(`/api/professionals/${id}/schedule`, { method: 'PUT', body: { blocks } }),
  saveProfessionalServices: (id: string, services: Array<{ itemId: string; priceOverride: number | null; durationOverride: number | null }>) => request<ProfessionalDto>(`/api/professionals/${id}/services`, { method: 'PUT', body: { services } }),
  timeOff: (id: string) => request<TimeOffDto[]>(`/api/professionals/${id}/time-off`),
  addTimeOff: (id: string, body: { startsAt: string; endsAt: string; reason: string }) => request<TimeOffDto>(`/api/professionals/${id}/time-off`, { method: 'POST', body }),
  deleteTimeOff: (id: string) => request<void>(`/api/time-off/${id}`, { method: 'DELETE' }),

  /* ---------- Estilos, paquetes y clasificación ---------- */
  variants: (itemId: string) => request<VariantDto[]>(`/api/items/${itemId}/variants`),
  addVariant: (itemId: string, body: VariantInput) => request<VariantDto>(`/api/items/${itemId}/variants`, { method: 'POST', body }),
  updateVariant: (id: string, body: VariantInput) => request<VariantDto>(`/api/variants/${id}`, { method: 'PUT', body }),
  deleteVariant: (id: string) => request<void>(`/api/variants/${id}`, { method: 'DELETE' }),
  packages: () => request<PackageDto[]>('/api/packages'),
  createPackage: (body: PackageInput) => request<PackageDto>('/api/packages', { method: 'POST', body }),
  updatePackage: (id: string, body: PackageInput) => request<PackageDto>(`/api/packages/${id}`, { method: 'PUT', body }),
  deletePackage: (id: string) => request<void>(`/api/packages/${id}`, { method: 'DELETE' }),
  classification: (all = false) => request<ClassificationEntry[]>(`/api/items/classification${all ? '?all=1' : ''}`),
  confirmClassification: (entries: Array<{ itemId: string; kind: 'service' | 'product'; durationMinutes?: number }>) => request<{ confirmed: number }>('/api/items/classification', { method: 'POST', body: { entries } }),

  subscription: () => request<Subscription>('/api/subscription'),
  startTrial: (plan: SubscriptionPlan, platform: SubscriptionPlatform) => request<Subscription>('/api/subscription/trial', { method: 'POST', body: { plan, platform } }),
  cancelSubscription: () => request<Subscription>('/api/subscription/cancel', { method: 'POST' }),
  checkoutStripe: (plan: SubscriptionPlan) => request<{ url: string }>('/api/subscription/checkout/stripe', { method: 'POST', body: { plan } }),
  checkoutPaypal: (plan: SubscriptionPlan) => request<{ url: string }>('/api/subscription/checkout/paypal', { method: 'POST', body: { plan } }),
  checkoutBankTransfer: (plan: SubscriptionPlan) => request<{ instructions: string; plan: SubscriptionPlan }>('/api/subscription/checkout/bank-transfer', { method: 'POST', body: { plan } }),
  subscriptionInvoices: () => request<{ invoices: SubscriptionInvoiceDto[] }>('/api/subscription/invoices').then((r) => r.invoices),
};

/** Lo elegido para reservar: servicios (con estilo), paquetes y el profesional; viaja como `services=id:estilo,id` y `packages=id,id`. */
export interface AvailabilityQuery {
  date?: string;
  professionalId?: string;
  services: Array<{ itemId: string; variantId?: string | null }>;
  packages: string[];
  /** Al mover una cita: ignórala al calcular horarios. */
  excludeAppointmentId?: string;
}

function availabilityParams(query: AvailabilityQuery & { from?: string; days?: number }): string {
  const params = new URLSearchParams();
  if (query.date) params.set('date', query.date);
  if (query.from) params.set('from', query.from);
  if (query.days) params.set('days', String(query.days));
  params.set('professionalId', query.professionalId ?? 'any');
  params.set('services', query.services.map((s) => (s.variantId ? `${s.itemId}:${s.variantId}` : s.itemId)).join(','));
  params.set('packages', query.packages.join(','));
  if (query.excludeAppointmentId) params.set('excludeAppointmentId', query.excludeAppointmentId);
  return params.toString();
}

/** Traduce un error de API a una clave de i18n (o el mensaje del primer campo inválido). */
export function errorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetwork) return error.code === 'timeout_error' ? 'timeout_error' : 'offline_error';
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
