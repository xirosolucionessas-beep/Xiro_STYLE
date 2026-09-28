import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { APPOINTMENT_STATUSES, PUBLIC_SECTIONS, SLOT_STATES, translate } from '@xiro/shared';
import { describe, expect, it } from 'vitest';
import { tw } from '../src/web/shell/strings';

const root = path.resolve(__dirname, '..');

function filesIn(target: string): string[] {
  const full = path.join(root, target);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => filesIn(path.join(target, name)));
}

/** Pantallas y componentes del módulo de Citas: TODO texto que muestran debe existir en español e inglés. */
const SOURCES = ['src/ui/agenda', 'src/ui/booking', 'src/ui/home/UpcomingList.tsx', 'src/ui/FormModal.tsx', 'src/app/(app)/agenda.tsx', 'src/app/(app)/booking.tsx', 'src/app/(app)/packages.tsx', 'src/app/(app)/review-items.tsx', 'src/app/(app)/(tabs)/index.tsx', 'src/app/(app)/(tabs)/index.web.tsx', 'src/app/(app)/item/form.tsx', 'src/web/screens/Dashboard.tsx', 'src/lib/menu.ts', 'src/web/shell/nav.ts', 'src/web/shell/routes.ts'];

/** Las pantallas de la capa web traducen con `tw` (web + compartido); las demás (Android, iOS y las compartidas) solo con el diccionario compartido. */
const isWebLayer = (file: string) => /[/\\]web[/\\]|\.web\.tsx?$/.test(file);
const lookup = (file: string, language: 'es' | 'en', key: string) => (isWebLayer(file) ? tw(language, key) : translate(language, key));

const literalKeys = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/\bt\('([a-z][a-z0-9_]*)'/g)].map((m) => m[1]!);
const labelKeys = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/(?:labelKey|titleKey):\s*'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]!);

describe('textos del módulo de Citas', () => {
  const files = SOURCES.flatMap(filesIn).filter((f) => /\.(ts|tsx)$/.test(f));

  it('cada clave usada existe en español y en inglés', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const key of new Set([...literalKeys(file), ...labelKeys(file)])) {
        for (const language of ['es', 'en'] as const) if (lookup(file, language, key) === key) missing.push(`${path.relative(root, file)} → ${language}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('las claves construidas dinámicamente también existen', () => {
    const dynamic = [
      ...APPOINTMENT_STATUSES.map((s) => `appt_status_${s}`),
      ...['app', 'web', 'walk_in'].map((s) => `appt_source_${s}`),
      ...['confirm', 'start', 'complete', 'no_show', 'cancel'].flatMap((a) => [`appt_action_${a}`, `appt_done_${a}`]),
      ...['cancel', 'no_show', 'complete'].flatMap((a) => [`appt_confirm_${a}_title`, `appt_confirm_${a}_text`]),
      ...SLOT_STATES.map((s) => `slot_${s}`),
      ...['link', 'info', 'rules', 'team', 'reviews'].map((tab) => `booking_tab_${tab}`),
      ...PUBLIC_SECTIONS.map((s) => `bk_section_${s}`),
      ...['pending', 'approved', 'hidden'].map((s) => `reviews_status_${s}`),
      ...[0, 1, 2, 3, 4, 5, 6].map((d) => `day_${d}`),
      ...['published', 'services', 'professionals', 'hours'].flatMap((s) => [`bk_setup_${s}`, `bk_setup_${s}_hint`]),
      ...['service', 'team', 'hours'].map((a) => `bk_setup_go_${a}`),
      // Mensajes de error que devuelve la API (y que la app muestra tal cual por su código).
      'slot_taken', 'slug_invalid', 'slug_reserved', 'slug_taken', 'booking_unavailable', 'invalid_transition', 'cancel_window_passed', 'modifications_exceeded', 'too_many_pending', 'captcha_failed', 'slot_not_allowed', 'professional_unavailable', 'item_not_bookable', 'date_invalid', 'time_invalid',
      ...['agenda_own', 'agenda_all', 'appointments_manage', 'public_page_manage'].flatMap((p) => [`perm_${p}`, `perm_${p}_hint`]),
    ];
    const missing = dynamic.filter((key) => translate('es', key) === key || translate('en', key) === key);
    expect(missing).toEqual([]);
  });

  it('los textos en español e inglés tienen los mismos parámetros {…}', () => {
    const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const keys = [...new Set(files.flatMap((f) => [...literalKeys(f), ...labelKeys(f)]))];
    const mismatched = keys.filter((key) => JSON.stringify(params(tw('es', key))) !== JSON.stringify(params(tw('en', key))));
    expect(mismatched).toEqual([]);
  });
});
