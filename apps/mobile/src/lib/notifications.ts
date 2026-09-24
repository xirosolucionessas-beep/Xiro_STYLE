import type { NotificationSettings, TranslationKey } from '@xiro/shared';
import type { PushAdapter, PushOutcome } from './pushTypes';

/** Mensaje a mostrar cuando activar NO terminó en "granted" (nunca se finge que quedó activo). */
export const OUTCOME_MESSAGE: Record<Exclude<PushOutcome, 'granted'>, TranslationKey> = {
  denied: 'notifications_permission_denied',
  unsupported: 'notifications_unsupported',
  not_configured: 'notifications_not_configured',
  ios_needs_install: 'notifications_ios_pwa_hint',
};

export type ToggleResult = { ok: true; settings: NotificationSettings } | { ok: false; messageKey?: TranslationKey };

interface Deps {
  push: PushAdapter;
  current: NotificationSettings;
  save: (next: NotificationSettings) => Promise<NotificationSettings>;
}

/**
 * Orden deliberado: primero la explicación (`confirmRationale`), luego el permiso del sistema, y SOLO si el registro
 * del dispositivo salió bien se guarda `enabled: true` en el servidor. Así el interruptor nunca queda "activo" sin
 * un dispositivo que pueda recibir avisos.
 */
export async function turnOn(deps: Deps & { confirmRationale: () => Promise<boolean> }): Promise<ToggleResult> {
  if (!(await deps.confirmRationale())) return { ok: false };
  const outcome = await deps.push.enable();
  if (outcome !== 'granted') return { ok: false, messageKey: OUTCOME_MESSAGE[outcome] };
  return { ok: true, settings: await deps.save({ ...deps.current, enabled: true }) };
}

export async function turnOff(deps: Deps): Promise<ToggleResult> {
  await deps.push.disable();
  return { ok: true, settings: await deps.save({ ...deps.current, enabled: false }) };
}
