import type {
  ApiErrorBody,
  AvailabilityResponse,
  BookingSelection,
  ClientAccountDto,
  ClientAppointmentDto,
  ClientSessionDeviceDto,
  DaySummary,
  PublicAppointmentDto,
  PublicBookingCatalog,
  PublicBookingProfile,
  PublicBookingResult,
  PublicDiscountDto,
  PublicProductOrderDto,
  PublicReviewDto,
  PublicTeamMemberDto,
  PublicWaitlistDto,
} from '@xiro/shared';
import { HTTP_TIMEOUT_MS, withRetry } from '@xiro/shared';

export interface LoyaltyAccountView {
  active: boolean;
  count?: number;
  goal?: number;
  rewardAvailable?: boolean;
  rewardMessage?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues: Array<{ path: string; message: string }> = [],
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

/** Un intento con tiempo máximo: sin respuesta a tiempo = `timeout_error`; sin red = `offline_error` (ambos status 0). */
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Cuerpo FormData (subida de foto): el navegador pone su propio Content-Type con el boundary — fijarlo a mano lo rompe.
  const isFormData = init.body instanceof FormData;
  const headers = { Accept: 'application/json', ...(init.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...init.headers };
  // Política común (@xiro/shared/http): solo GET se reintenta (hasta 3 intentos, backoff con jitter); reservar, cancelar
  // o subir una foto NUNCA se repiten solas.
  const response = await withRetry(
    init.method,
    () => fetchOnce(`/api/public/booking${path}`, { ...init, headers }),
    (res) => res.status,
    (error) => error instanceof ApiError && error.isNetwork,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(response.status, body?.code ?? 'unknown_error', body?.issues, (body ?? {}) as Record<string, unknown>);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Lo elegido viaja en la URL como `services=id:estilo,id` y `packages=id,id` (mismo formato que usa el resto de la app). */
function selectionParams(selection: Pick<BookingSelection, 'services' | 'packages'>): string {
  const params = new URLSearchParams();
  params.set('services', selection.services.map((s) => (s.variantId ? `${s.itemId}:${s.variantId}` : s.itemId)).join(','));
  params.set('packages', selection.packages.join(','));
  return params.toString();
}

export const publicApi = {
  profile: (slug: string) => request<PublicBookingProfile>(`/${slug}`),
  catalog: (slug: string) => request<PublicBookingCatalog>(`/${slug}/catalog`),
  team: (slug: string) => request<PublicTeamMemberDto[]>(`/${slug}/team`),
  reviews: (slug: string) => request<PublicReviewDto[]>(`/${slug}/reviews`),

  availability: (slug: string, date: string, professionalId: string, selection: Pick<BookingSelection, 'services' | 'packages'>) =>
    request<AvailabilityResponse>(`/${slug}/availability?date=${date}&professionalId=${professionalId}&${selectionParams(selection)}`),
  days: (slug: string, from: string, days: number, professionalId: string, selection: Pick<BookingSelection, 'services' | 'packages'>) =>
    request<DaySummary[]>(`/${slug}/days?from=${from}&days=${days}&professionalId=${professionalId}&${selectionParams(selection)}`),

  book: (slug: string, body: unknown) => request<PublicBookingResult>(`/${slug}/appointments`, { method: 'POST', body: JSON.stringify(body) }),
  /** Pedido de solo productos (recoger y pagar en el local). Repetir el mismo `idempotencyKey` devuelve el mismo pedido. */
  order: (slug: string, body: unknown) => request<{ order: PublicProductOrderDto }>(`/${slug}/orders`, { method: 'POST', body: JSON.stringify(body) }),

  /** Vista previa de un código de descuento (el canje real lo hace el servidor al confirmar). */
  discount: (slug: string, code: string) => request<PublicDiscountDto>(`/${slug}/discount?code=${encodeURIComponent(code)}`),
  joinWaitlist: (slug: string, body: unknown) => request<{ entry: PublicWaitlistDto; token: string; manageUrl: string }>(`/${slug}/waitlist`, { method: 'POST', body: JSON.stringify(body) }),
  waitlist: (slug: string, token: string) => request<PublicWaitlistDto>(`/${slug}/waitlist/${token}`),
  cancelWaitlist: (slug: string, token: string) => request<PublicWaitlistDto>(`/${slug}/waitlist/${token}/cancel`, { method: 'POST' }),
  /** Enlace firmado para reseñar (llega al completar la cita, si el negocio lo activó): solo sirve para reseñar. */
  reviewLink: (slug: string, token: string) => request<PublicAppointmentDto>(`/${slug}/review-link/${token}`),
  submitReviewLink: (slug: string, token: string, rating: number, comment: string) => request<PublicAppointmentDto>(`/${slug}/review-link/${token}`, { method: 'POST', body: JSON.stringify({ rating, comment }) }),

  appointment: (slug: string, token: string) => request<PublicAppointmentDto>(`/${slug}/appointments/${token}`),
  cancel: (slug: string, token: string, reason: string) => request<PublicAppointmentDto>(`/${slug}/appointments/${token}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reschedule: (slug: string, token: string, startsAt: string, professionalId?: string) =>
    request<PublicAppointmentDto>(`/${slug}/appointments/${token}/reschedule`, { method: 'POST', body: JSON.stringify({ startsAt, ...(professionalId ? { professionalId } : {}) }) }),
  deleteData: (slug: string, token: string) => request<{ ok: true }>(`/${slug}/appointments/${token}/privacy-delete`, { method: 'POST' }),
  review: (slug: string, token: string, rating: number, comment: string) => request<PublicAppointmentDto>(`/${slug}/appointments/${token}/review`, { method: 'POST', body: JSON.stringify({ rating, comment }) }),

  accountMe: (slug: string) => request<ClientAccountDto | undefined>(`/${slug}/account/me`),
  accountRegister: (slug: string, body: { name: string; phone: string; password: string; email?: string; acceptTerms: true; remember: boolean }) =>
    request<ClientAccountDto>(`/${slug}/account/register`, { method: 'POST', body: JSON.stringify(body) }),
  accountLogin: (slug: string, body: { phone: string; password: string; remember: boolean }) => request<ClientAccountDto>(`/${slug}/account/login`, { method: 'POST', body: JSON.stringify(body) }),
  accountLogout: (slug: string) => request<void>(`/${slug}/account/logout`, { method: 'POST' }),
  accountUpdate: (slug: string, body: { name?: string; email?: string | null }) => request<ClientAccountDto>(`/${slug}/account/me`, { method: 'PUT', body: JSON.stringify(body) }),
  accountUploadPhoto: (slug: string, file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return request<ClientAccountDto>(`/${slug}/account/photo`, { method: 'PUT', body: form });
  },
  accountChangePassword: (slug: string, body: { currentPassword: string; newPassword: string }) => request<{ ok: true }>(`/${slug}/account/change-password`, { method: 'POST', body: JSON.stringify(body) }),
  accountDelete: (slug: string, password: string) => request<void>(`/${slug}/account`, { method: 'DELETE', body: JSON.stringify({ password }) }),
  accountSessions: (slug: string) => request<ClientSessionDeviceDto[]>(`/${slug}/account/sessions`),
  accountRevokeSession: (slug: string, id: string) => request<void>(`/${slug}/account/sessions/${id}`, { method: 'DELETE' }),
  accountRecoverRequest: (slug: string, phone: string) => request<{ ok: true; devCode?: string }>(`/${slug}/account/recover/request`, { method: 'POST', body: JSON.stringify({ phone }) }),
  accountRecoverVerify: (slug: string, phone: string, code: string) => request<{ resetToken: string }>(`/${slug}/account/recover/verify`, { method: 'POST', body: JSON.stringify({ phone, code }) }),
  accountRecoverReset: (slug: string, resetToken: string, newPassword: string) => request<{ ok: true }>(`/${slug}/account/recover/reset`, { method: 'POST', body: JSON.stringify({ resetToken, newPassword }) }),
  accountAppointments: (slug: string) => request<ClientAppointmentDto[]>(`/${slug}/account/appointments`),
  /** Calificar una cita propia ya completada (con sesión): queda por revisar hasta que el negocio la apruebe. */
  accountReview: (slug: string, id: string, rating: number, comment: string) => request<ClientAppointmentDto>(`/${slug}/account/appointments/${id}/review`, { method: 'POST', body: JSON.stringify({ rating, comment }) }),
  accountCancelAppointment: (slug: string, id: string, reason = '') => request<ClientAppointmentDto>(`/${slug}/account/appointments/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  accountLoyalty: (slug: string) => request<LoyaltyAccountView>(`/${slug}/account/loyalty`),
};
