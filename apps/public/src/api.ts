import type {
  ApiErrorBody,
  AvailabilityResponse,
  BookingSelection,
  DaySummary,
  PublicAppointmentDto,
  PublicBookingCatalog,
  PublicBookingProfile,
  PublicBookingResult,
  PublicReviewDto,
  PublicTeamMemberDto,
} from '@xiro/shared';

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/public/booking${path}`, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  } catch {
    throw new ApiError(0, 'offline_error');
  }
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

  appointment: (slug: string, token: string) => request<PublicAppointmentDto>(`/${slug}/appointments/${token}`),
  cancel: (slug: string, token: string, reason: string) => request<PublicAppointmentDto>(`/${slug}/appointments/${token}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reschedule: (slug: string, token: string, startsAt: string, professionalId?: string) =>
    request<PublicAppointmentDto>(`/${slug}/appointments/${token}/reschedule`, { method: 'POST', body: JSON.stringify({ startsAt, ...(professionalId ? { professionalId } : {}) }) }),
  deleteData: (slug: string, token: string) => request<{ ok: true }>(`/${slug}/appointments/${token}/privacy-delete`, { method: 'POST' }),
  review: (slug: string, token: string, rating: number, comment: string) => request<PublicAppointmentDto>(`/${slug}/appointments/${token}/review`, { method: 'POST', body: JSON.stringify({ rating, comment }) }),
};
