export type PositionErrorCode = 'denied' | 'unavailable' | 'timeout';

/** Por qué no se pudo obtener la ubicación del dispositivo: la pantalla traduce cada código a un mensaje que dice qué hacer. */
export class PositionError extends Error {
  constructor(readonly code: PositionErrorCode) {
    super(code);
  }
}
