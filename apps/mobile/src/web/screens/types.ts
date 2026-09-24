export interface SubmitResult {
  ok: boolean;
  /** Errores de campo ya traducidos. */
  fields?: Record<string, string>;
  /** Mensaje general ya traducido (credenciales, red, límite de intentos…). */
  general?: string;
}
