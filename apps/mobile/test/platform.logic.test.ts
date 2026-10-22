import { describe, expect, it } from 'vitest';
import { bucketLabel, niceTicks } from '../src/ui/platform/chart';
import { auditActionText, errorText, isUncertain, textFor, type PlatformText } from '../src/ui/platform/texts';

// Traductor mínimo: devuelve la clave (con variables) para comprobar QUÉ texto se elige sin depender del idioma.
const pt: PlatformText = (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

describe('panel de plataforma: gráfica', () => {
  it('el eje Y usa marcas enteras y "redondas" que cubren el máximo', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(130)).toEqual([0, 50, 100, 150]);
    for (const max of [1, 9, 41, 999, 12_345]) {
      const ticks = niceTicks(max);
      expect(ticks.at(-1)!).toBeGreaterThanOrEqual(max);
      expect(ticks.every((t) => Number.isInteger(t))).toBe(true);
    }
  });

  it('etiqueta cada período según la agrupación, sin correrse de día por la zona horaria del equipo', () => {
    expect(bucketLabel('2026-10-01', 'day', 'es', pt)).toMatch(/1/);
    expect(bucketLabel('2026-10-01', 'day', 'es', pt)).toMatch(/oct/i);
    expect(bucketLabel('2026-10-05', 'week', 'es', pt)).toMatch(/^chart_week_of 5/);
    expect(bucketLabel('2026-10-01', 'month', 'en', pt)).toMatch(/Oct.*2026/);
  });
});

describe('panel de plataforma: textos', () => {
  it('traduce las acciones de la bitácora y nunca muestra el código interno', () => {
    expect(auditActionText(pt, 'business.grant_access')).toBe('act_business_grant_access');
    expect(auditActionText(pt, 'business.create')).toBe('act_business_create');
    expect(auditActionText(pt, 'cli.create_admin')).toBe('act_cli');
    expect(auditActionText(pt, 'denied:/api/platform/businesses')).toBe('act_denied');
    expect(auditActionText(pt, 'algo.desconocido')).toBe('act_other');
  });

  it('una conexión perdida es un resultado INCIERTO, distinto de un error del servidor', () => {
    expect(isUncertain('timeout_error')).toBe(true);
    expect(isUncertain('offline_error')).toBe(true);
    expect(isUncertain('validation_error')).toBe(false);
    expect(errorText(pt, 'account_exists')).toBe('account_exists');
    expect(errorText(pt, 'codigo_que_no_existe')).toBe('unknown_error');
  });

  it('el aviso de éxito de una ampliación incluye cantidad, negocio y la nueva fecha (en ambos idiomas)', () => {
    const vars = { amount: 30, unit: 'días', business: 'Barbería Sol', date: '17 de noviembre de 2026' };
    expect(textFor('es', 'grant_done_full', vars)).toBe('¡Listo! Se añadieron 30 días a la cuenta de Barbería Sol. Nueva fecha de vencimiento: 17 de noviembre de 2026.');
    expect(textFor('en', 'grant_done_full', { ...vars, unit: 'days' })).toContain('30 days were added to Barbería Sol');
  });
});
