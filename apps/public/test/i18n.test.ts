import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { APPOINTMENT_STATUSES, SLOT_STATES, translate } from '@xiro/shared';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

function filesIn(target: string): string[] {
  const full = path.join(root, target);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => filesIn(path.join(target, name)));
}

const files = filesIn('src').filter((f) => /\.(ts|tsx)$/.test(f));
const literalKeys = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/\bt\('([a-z][a-z0-9_]*)'/g)].map((m) => m[1]!);

describe('textos de la página pública', () => {
  it('cada clave usada con t(...) existe en español y en inglés', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const key of new Set(literalKeys(file))) {
        for (const language of ['es', 'en'] as const) if (translate(language, key) === key) missing.push(`${path.relative(root, file)} → ${language}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('las claves construidas dinámicamente también existen', () => {
    const dynamic = [...APPOINTMENT_STATUSES.map((s) => `appt_status_${s}`), ...SLOT_STATES.map((s) => `pub_slot_${s}`), 'call', 'phone', 'email', 'not_found', 'slot_taken', 'cancel_window_passed', 'modifications_exceeded', 'too_many_pending', 'captcha_failed', 'slot_not_allowed', 'professional_unavailable', 'item_not_bookable', 'date_invalid', 'terms_required', 'phone_invalid'];
    const missing = dynamic.filter((key) => translate('es', key) === key || translate('en', key) === key);
    expect(missing).toEqual([]);
  });

  it('los textos en español e inglés usan los mismos parámetros {…}', () => {
    const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const keys = new Set(files.flatMap(literalKeys));
    const mismatched = [...keys].filter((key) => JSON.stringify(params(translate('es', key))) !== JSON.stringify(params(translate('en', key))));
    expect(mismatched).toEqual([]);
  });
});
