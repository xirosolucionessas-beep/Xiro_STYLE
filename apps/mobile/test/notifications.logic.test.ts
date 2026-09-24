import { isTranslationKey, translate, type NotificationSettings } from '@xiro/shared';
import { describe, expect, it, vi } from 'vitest';
import { OUTCOME_MESSAGE, turnOff, turnOn } from '../src/lib/notifications';
import type { PushAdapter, PushOutcome } from '../src/lib/pushTypes';
import { urlBase64ToBytes } from '../src/lib/vapid';

const current: NotificationSettings = { enabled: false, loyaltyEnabled: true, billingEnabled: false };

function deps(outcome: PushOutcome = 'granted') {
  const push: PushAdapter = { enable: vi.fn(async () => outcome), disable: vi.fn(async () => undefined) };
  const save = vi.fn(async (next: NotificationSettings) => next);
  return { push, save, current };
}

describe('turnOn', () => {
  it('does nothing (no system prompt, no save) when the person declines the explanation', async () => {
    const d = deps();
    const result = await turnOn({ ...d, confirmRationale: async () => false });
    expect(result).toEqual({ ok: false });
    expect(d.push.enable).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });

  it('asks for the permission only after the explanation, and saves enabled:true keeping the category choices', async () => {
    const d = deps('granted');
    const order: string[] = [];
    const result = await turnOn({
      ...d,
      confirmRationale: async () => (order.push('rationale'), true),
      push: { enable: async () => (order.push('permission'), 'granted' as const), disable: d.push.disable },
    });
    expect(order).toEqual(['rationale', 'permission']);
    expect(result).toEqual({ ok: true, settings: { enabled: true, loyaltyEnabled: true, billingEnabled: false } });
  });

  it.each(['denied', 'unsupported', 'not_configured', 'ios_needs_install'] as const)('%s: stays off, never saves enabled:true, and reports why', async (outcome) => {
    const d = deps(outcome);
    const result = await turnOn({ ...d, confirmRationale: async () => true });
    expect(result).toEqual({ ok: false, messageKey: OUTCOME_MESSAGE[outcome] });
    expect(d.save).not.toHaveBeenCalled();
  });
});

describe('turnOff', () => {
  it('unregisters this device and saves enabled:false', async () => {
    const d = deps();
    const result = await turnOff({ ...d, current: { ...current, enabled: true } });
    expect(d.push.disable).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, settings: { enabled: false, loyaltyEnabled: true, billingEnabled: false } });
  });
});

describe('strings', () => {
  it('every outcome message and push text exists in Spanish and English', () => {
    for (const key of [...Object.values(OUTCOME_MESSAGE), 'notifications', 'notifications_test_sent', 'push_no_devices', 'push_loyalty_reward_body']) {
      expect(isTranslationKey(key), key).toBe(true);
      expect(translate('es', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
    }
  });
});

describe('urlBase64ToBytes', () => {
  it('decodes base64url (no padding, - and _) into bytes', () => {
    expect([...urlBase64ToBytes('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToBytes('-_8')]).toEqual([251, 255]);
  });
});
