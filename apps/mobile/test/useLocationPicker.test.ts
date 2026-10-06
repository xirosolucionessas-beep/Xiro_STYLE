import { act, renderHook } from '@testing-library/react';
import type { PickedLocation } from '@xiro/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api';
import { getCurrentPosition } from '../src/lib/currentPosition';
import { PositionError } from '../src/lib/positionError';
import { usePlacesConfig } from '../src/lib/queries';
import { SEARCH_DEBOUNCE_MS, useLocationPicker } from '../src/lib/useLocationPicker';

vi.mock('../src/lib/api', () => ({
  api: { placesAutocomplete: vi.fn(), placesDetails: vi.fn(), placesReverse: vi.fn() },
  errorKey: (error: unknown) => (error instanceof Error ? error.message : 'unknown_error'),
}));
vi.mock('../src/lib/queries', () => ({ usePlacesConfig: vi.fn() }));
vi.mock('../src/lib/currentPosition', () => ({ getCurrentPosition: vi.fn() }));

const PLACE = 'ChIJ_lugar_de_prueba_123';
const config = (enabled: boolean, pending = false) => vi.mocked(usePlacesConfig).mockReturnValue({ data: pending ? undefined : { enabled, browserKey: null }, isPending: pending } as never);

function setup() {
  const onChange = vi.fn<(next: PickedLocation | null) => void>();
  const hook = renderHook(() => useLocationPicker({ value: null, onChange, language: 'es' }));
  return { onChange, hook, picker: () => hook.result.current };
}
const type = async (hook: ReturnType<typeof setup>['hook'], text: string) => act(async () => hook.result.current.changeQuery(text));
/** Teclear de verdad: una letra a la vez (un salto grande de texto se considera un pegado). */
const typeKeys = async (hook: ReturnType<typeof setup>['hook'], text: string) => {
  for (let i = 1; i <= text.length; i++) await act(async () => hook.result.current.changeQuery(text.slice(0, i)));
};
const wait = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('useLocationPicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    config(true);
    vi.mocked(api.placesAutocomplete).mockResolvedValue([{ placeId: PLACE, text: 'Carrera 7 # 71-21', secondaryText: 'Bogotá' }]);
    vi.mocked(api.placesDetails).mockResolvedValue({ lat: 4.6533, lng: -74.0836, address: 'Cra. 7 #71-21, Bogotá', placeId: PLACE });
    vi.mocked(api.placesReverse).mockResolvedValue({ address: 'Dirección del pin', placeId: PLACE });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('búsqueda', () => {
    it('espera ~300 ms tras la última tecla y busca una sola vez con el texto final', async () => {
      const { hook, picker } = setup();
      await type(hook, 'carr');
      await wait(200);
      await type(hook, 'carrera 7');
      await wait(SEARCH_DEBOUNCE_MS - 1);
      expect(api.placesAutocomplete).not.toHaveBeenCalled();
      expect(picker().status).toBe('bk_loc_searching'); // el estado de carga se ve desde que se teclea
      await wait(2);
      expect(api.placesAutocomplete).toHaveBeenCalledOnce();
      expect(vi.mocked(api.placesAutocomplete).mock.calls[0]).toEqual(['carrera 7', expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/), 'es']);
      expect(picker().suggestions).toHaveLength(1);
      expect(picker().status).toBeNull();
    });

    it('con menos de 3 letras no busca, y sin resultados lo dice', async () => {
      const { hook, picker } = setup();
      await type(hook, 'ca');
      await wait(1000);
      expect(api.placesAutocomplete).not.toHaveBeenCalled();
      vi.mocked(api.placesAutocomplete).mockResolvedValueOnce([]);
      await type(hook, 'zzzzzz');
      await wait(SEARCH_DEBOUNCE_MS + 1);
      expect(picker().error).toBe('bk_loc_no_results');
    });

    it('nunca muestra resultados de un texto anterior: al seguir tecleando, la lista vieja desaparece', async () => {
      const { hook, picker } = setup();
      await type(hook, 'carrera');
      await wait(SEARCH_DEBOUNCE_MS + 1);
      expect(picker().suggestions).toHaveLength(1);
      await type(hook, 'carrera 7');
      expect(picker().suggestions).toEqual([]);
    });

    it('si buscar falla lo dice con un mensaje accionable', async () => {
      vi.mocked(api.placesAutocomplete).mockRejectedValueOnce(new Error('x'));
      const { hook, picker } = setup();
      await type(hook, 'carrera');
      await wait(SEARCH_DEBOUNCE_MS + 1);
      expect(picker().error).toBe('bk_loc_err_search');
    });

    it('elegir una sugerencia: coordenadas y dirección del lugar, texto limpio y una sesión de Places NUEVA para la próxima búsqueda', async () => {
      const { hook, picker, onChange } = setup();
      await type(hook, 'carrera');
      await wait(SEARCH_DEBOUNCE_MS + 1);
      const firstSession = vi.mocked(api.placesAutocomplete).mock.calls[0]![1];
      await act(async () => picker().pick(picker().suggestions[0]!));
      expect(vi.mocked(api.placesDetails).mock.calls[0]).toEqual([PLACE, firstSession, 'es']); // la misma sesión: se factura una vez
      expect(onChange).toHaveBeenLastCalledWith({ lat: 4.6533, lng: -74.0836, address: 'Cra. 7 #71-21, Bogotá', placeId: PLACE });
      expect(picker().query).toBe('');
      await type(hook, 'otra cosa');
      await wait(SEARCH_DEBOUNCE_MS + 1);
      expect(vi.mocked(api.placesAutocomplete).mock.calls[1]![1]).not.toBe(firstSession);
    });
  });

  describe('coordenadas y enlaces', () => {
    it('al teclear coordenadas las ofrece pero no las aplica; ni busca en Google', async () => {
      const { hook, picker, onChange } = setup();
      await typeKeys(hook, '4.0833, -76.2');
      expect(picker().coordsOffer).toEqual({ lat: 4.0833, lng: -76.2 });
      await wait(1000);
      expect(onChange).not.toHaveBeenCalled();
      expect(api.placesAutocomplete).not.toHaveBeenCalled();
    });

    it('al PEGAR grados o un enlace de Google Maps se aplica solo: primero mueve el pin y luego trae la dirección, con las coordenadas exactas', async () => {
      const { hook, onChange } = setup();
      await type(hook, '4°05\'00"N 76°12\'00"W');
      expect(onChange).toHaveBeenNthCalledWith(1, { lat: 4.083333, lng: -76.2, address: '', placeId: null });
      expect(onChange).toHaveBeenNthCalledWith(2, { lat: 4.083333, lng: -76.2, address: 'Dirección del pin', placeId: PLACE });
      expect(vi.mocked(api.placesReverse).mock.calls[0]).toEqual([4.083333, -76.2, 'es']);
    });

    it('un enlace largo de Google Maps pegado da el pin del lugar', async () => {
      const { hook, onChange } = setup();
      await type(hook, 'https://www.google.com/maps/place/Mi+Local/@4.1,-76.1,17z/data=!3d4.0833!4d-76.2');
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 4.0833, lng: -76.2 }));
    });

    it('un enlace corto o coordenadas imposibles dicen qué hacer', async () => {
      const { hook, picker } = setup();
      await type(hook, 'https://maps.app.goo.gl/AbCdEf123');
      expect(picker().error).toBe('bk_loc_err_short_link');
      await type(hook, '95.5, 10');
      expect(picker().error).toBe('bk_loc_err_range');
    });

    it('aceptar la oferta de coordenadas también aplica el punto', async () => {
      const { hook, picker, onChange } = setup();
      await typeKeys(hook, '4.65, -74.08');
      await act(async () => picker().applyCoords(picker().coordsOffer!));
      expect(onChange).toHaveBeenLastCalledWith({ lat: 4.65, lng: -74.08, address: 'Dirección del pin', placeId: PLACE });
    });
  });

  describe('pin y dirección', () => {
    it('soltar el pin conserva las coordenadas EXACTAS y solo actualiza la dirección', async () => {
      vi.mocked(api.placesReverse).mockResolvedValue({ address: 'Otra dirección', placeId: null });
      const { picker, onChange } = setup();
      await act(async () => picker().movePin({ lat: 4.12345678, lng: -76.98765432 }));
      expect(onChange).toHaveBeenLastCalledWith({ lat: 4.123457, lng: -76.987654, address: 'Otra dirección', placeId: null });
    });

    it('si dos movimientos se pisan, la dirección del anterior no pisa al último', async () => {
      let releaseFirst!: (v: { address: string; placeId: null }) => void;
      vi.mocked(api.placesReverse).mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve as never)));
      vi.mocked(api.placesReverse).mockResolvedValueOnce({ address: 'Segunda', placeId: null });
      const { picker, onChange } = setup();
      let first!: Promise<void>;
      await act(async () => void (first = picker().movePin({ lat: 1, lng: 1 })));
      await act(async () => picker().movePin({ lat: 2, lng: 2 }));
      await act(async () => {
        releaseFirst({ address: 'Primera (tardía)', placeId: null });
        await first;
      });
      expect(onChange).toHaveBeenLastCalledWith({ lat: 2, lng: 2, address: 'Segunda', placeId: null });
      expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ address: 'Primera (tardía)' }));
    });

    it('si la dirección falla, el punto queda guardado y se dice por qué', async () => {
      vi.mocked(api.placesReverse).mockRejectedValueOnce(new Error('places_upstream_error'));
      const { picker, onChange } = setup();
      await act(async () => picker().movePin({ lat: 4.6, lng: -74.1 }));
      expect(onChange).toHaveBeenLastCalledWith({ lat: 4.6, lng: -74.1, address: '', placeId: null });
      expect(picker().error).toBe('places_upstream_error');
    });

    it('un punto sin dirección (mar, desierto) se guarda y lo avisa', async () => {
      vi.mocked(api.placesReverse).mockResolvedValueOnce({ address: '', placeId: null });
      const { picker } = setup();
      await act(async () => picker().movePin({ lat: 0, lng: -30 }));
      expect(picker().error).toBe('bk_loc_no_address');
    });

    it('Quitar borra la ubicación', async () => {
      const { picker, onChange } = setup();
      await act(async () => picker().clear());
      expect(onChange).toHaveBeenLastCalledWith(null);
    });
  });

  describe('mi ubicación actual', () => {
    it('la convierte en punto y dirección, mostrando "Obteniendo tu ubicación…" mientras espera', async () => {
      let resolvePosition!: (p: { lat: number; lng: number }) => void;
      vi.mocked(getCurrentPosition).mockReturnValueOnce(new Promise((resolve) => (resolvePosition = resolve)));
      const { picker, onChange } = setup();
      let done!: Promise<void>;
      await act(async () => void (done = picker().locate()));
      expect(picker().status).toBe('bk_loc_locating');
      await act(async () => {
        resolvePosition({ lat: 4.7, lng: -74.05 });
        await done;
      });
      expect(onChange).toHaveBeenLastCalledWith({ lat: 4.7, lng: -74.05, address: 'Dirección del pin', placeId: PLACE });
      expect(picker().status).toBeNull();
    });

    it.each([
      ['denied', 'bk_loc_err_denied'],
      ['unavailable', 'bk_loc_err_unavailable'],
      ['timeout', 'bk_loc_err_timeout'],
    ] as const)('permiso o GPS "%s": mensaje claro y nada cambia', async (code, key) => {
      vi.mocked(getCurrentPosition).mockRejectedValueOnce(new PositionError(code));
      const { picker, onChange } = setup();
      await act(async () => picker().locate());
      expect(picker().error).toBe(key);
      expect(picker().busy).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('sin Google configurado', () => {
    it('no busca en Google, pero pegar coordenadas funciona y avisa que la dirección no está disponible', async () => {
      config(false);
      vi.mocked(api.placesReverse).mockRejectedValueOnce(new Error('places_not_configured'));
      const { hook, picker, onChange } = setup();
      expect(picker().searchEnabled).toBe(false);
      await type(hook, 'carrera 7 con calle 71');
      await wait(1000);
      expect(api.placesAutocomplete).not.toHaveBeenCalled();
      await typeKeys(hook, '4.0833, -76.2');
      await act(async () => picker().applyCoords(picker().coordsOffer!));
      expect(onChange).toHaveBeenLastCalledWith({ lat: 4.0833, lng: -76.2, address: '', placeId: null });
      expect(picker().error).toBe('bk_loc_not_configured');
    });
  });
});
