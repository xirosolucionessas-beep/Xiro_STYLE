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

  items: () => request<Item[]>('/api/items'),
  item: (id: string) => request<Item>(`/api/items/${id}`),
  createItem: (body: ItemInput) => request<Item>('/api/items', { method: 'POST', body }),
  updateItem: (id: string, body: ItemInput) => request<Item>(`/api/items/${id}`, { method: 'PUT', body }),
  deleteItem: (id: string) => request<void>(`/api/items/${id}`, { method: 'DELETE' }),
  bulkPublish: (ids: string[], published: boolean) => request<{ updated: number }>('/api/items/bulk-publish', { method: 'POST', body: { ids, published } }),
  addPhoto: (id: string, form: FormData) => request<Item>(`/api/items/${id}/photos`, { method: 'POST', form }),
  deletePhoto: (id: string, photoId: string) => request<Item>(`/api/items/${id}/photos/${photoId}`, { method: 'DELETE' }),
  makePrimaryPhoto: (id: string, photoId: string) => request<Item>(`/api/items/${id}/photos/${photoId}/primary`, { method: 'POST' }),

  clients: (q?: string) => request<Client[]>(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
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
  loyaltyClients: () => request<LoyaltyClientProgress[]>('/api/loyalty/clients'),
  loyaltyRedemptions: (clientId?: string) => request<LoyaltyRedemption[]>(`/api/loyalty/redemptions${clientId ? `?clientId=${clientId}` : ''}`),
  redeemLoyalty: (clientId: string) => request<LoyaltyClientProgress>(`/api/loyalty/clients/${clientId}/redeem`, { method: 'POST' }),
  serviceRecords: (clientId?: string) => request<ServiceRecord[]>(`/api/service-records${clientId ? `?clientId=${clientId}` : ''}`),
  createServiceRecord: (body: ServiceRecordInput) => request<ServiceRecord & { rewardJustEarned: boolean }>('/api/service-records', { method: 'POST', body }),

  /* ---------- Ventas (POS) ---------- */
  // limit=200 (el máximo que acepta el servidor): un rango largo (mes/año, para Reportes) no debe cortarse antes de tiempo.
  sales: (query: { from: string; to: string }) => request<SaleDto[]>(`/api/sales?${new URLSearchParams({ from: query.from, to: query.to, limit: '200' }).toString()}`),
  createSale: (body: SaleInput) => request<SaleDto & { rewardJustEarned: boolean }>('/api/sales', { method: 'POST', body }),
  voidSale: (id: string, reason: string) => request<SaleDto>(`/api/sales/${id}/void`, { method: 'POST', body: { reason } }),

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
  bookingReviews: () => request<ReviewDto[]>('/api/booking/reviews'),
  moderateReview: (id: string, status: 'approved' | 'hidden') => request<ReviewDto>(`/api/booking/reviews/${id}`, { method: 'PATCH', body: { status } }),

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
