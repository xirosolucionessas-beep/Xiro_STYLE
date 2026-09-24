export const OTP_LENGTH = 6;

/** Solo dígitos, como máximo 6. */
export const cleanOtp = (value: string) => value.replace(/\D/g, '').slice(0, OTP_LENGTH);

/** Reparte un texto pegado a partir de la casilla `index`: devuelve las 6 casillas y dónde debe quedar el foco. */
export function pasteInto(digits: string[], index: number, pasted: string): { digits: string[]; focus: number } {
  const clean = pasted.replace(/\D/g, '');
  const next = [...digits];
  if (!clean) return { digits: next, focus: index };
  // Un pegado de 6 dígitos completo siempre llena todo (aunque se pegue en el medio).
  const start = clean.length >= OTP_LENGTH ? 0 : index;
  for (let i = 0; i < clean.length && start + i < OTP_LENGTH; i += 1) next[start + i] = clean[i]!;
  return { digits: next, focus: Math.min(start + clean.length, OTP_LENGTH - 1) };
}

export const otpValue = (digits: string[]) => digits.join('');

/** 58 → "00:58". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const RESEND_SECONDS = 60;
