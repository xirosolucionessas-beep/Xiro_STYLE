import { describe, expect, it } from 'vitest';
import { flagEmoji, COUNTRIES } from '../src/lib/countries';
import { supportMailtoUrl, supportMessage, supportWhatsappUrl, XIRO_CONTACT } from '../src/lib/contact';
import { DRAFT_TTL_MS, emptyDraft, hasUnsavedInput, parseDraft, serializeDraft, type RegistrationDraft } from '../src/lib/registrationDraft';
import { withRemember, type KeyValueLike } from '../src/lib/rememberSession';

function fakeStore(): KeyValueLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
  };
}

describe('withRemember ("Recordarme")', () => {
  it('por defecto persiste la sesión', async () => {
    const persistent = fakeStore();
    const { store } = withRemember(persistent);
    await store.set('refresh', 'tok1');
    expect(persistent.data.get('refresh')).toBe('tok1');
    expect(await store.get('refresh')).toBe('tok1');
  });

  it('sin recordar: vive solo en memoria y borra la copia persistente anterior', async () => {
    const persistent = fakeStore();
    persistent.data.set('refresh', 'viejo');
    const { store, setRemember } = withRemember(persistent);
    setRemember(false);
    await store.set('refresh', 'tok2');
    expect(persistent.data.has('refresh')).toBe(false); // tras "cerrar la app" no queda nada
    expect(await store.get('refresh')).toBe('tok2'); // pero durante esta ejecución la sesión funciona (rotación incluida)
    await store.set('refresh', 'tok3');
    expect(await store.get('refresh')).toBe('tok3');
    expect(persistent.data.has('refresh')).toBe(false);
  });

  it('volver a recordar mueve el valor al almacén persistente', async () => {
    const persistent = fakeStore();
    const { store, setRemember } = withRemember(persistent);
    setRemember(false);
    await store.set('refresh', 'a');
    setRemember(true);
    await store.set('refresh', 'b');
    expect(persistent.data.get('refresh')).toBe('b');
    expect(await store.get('refresh')).toBe('b');
  });

  it('cerrar sesión borra memoria y almacén', async () => {
    const persistent = fakeStore();
    const { store, setRemember } = withRemember(persistent);
    setRemember(false);
    await store.set('refresh', 'a');
    await store.remove('refresh');
    expect(await store.get('refresh')).toBeNull();
  });
});

describe('borrador del registro', () => {
  const draft = (over: Partial<RegistrationDraft> = {}): RegistrationDraft => ({ ...emptyDraft(), name: 'Ana Pérez', businessName: 'Studio Ana', email: 'ana@correo.com', step: 2, ...over });

  it('ida y vuelta conserva los datos, el paso y el horario', () => {
    const original = draft({ country: 'MX', address: 'Calle 1 # 2-3', city: 'Bogotá', accepted: true, step: 3 });
    expect(parseDraft(serializeDraft(original))).toEqual(original);
  });

  it('NUNCA incluye la contraseña ni su confirmación: el borrador ni siquiera tiene esos campos', () => {
    expect(Object.keys(emptyDraft())).not.toEqual(expect.arrayContaining(['password']));
    expect(Object.keys(emptyDraft())).not.toEqual(expect.arrayContaining(['confirm']));
    expect(serializeDraft(draft({ name: 'Ana' }))).not.toMatch(/password|confirm/i);
  });

  it('caduca a los 7 días', () => {
    const raw = serializeDraft(draft(), 1_000);
    expect(parseDraft(raw, 1_000 + DRAFT_TTL_MS)).not.toBeNull();
    expect(parseDraft(raw, 1_001 + DRAFT_TTL_MS)).toBeNull();
  });

  it.each([null, '', 'no es json', '{}', '{"v":2,"savedAt":1,"data":{}}', '{"v":1,"savedAt":"x","data":{}}'])('descarta lo inválido sin lanzar: %s', (raw) => {
    expect(parseDraft(raw as string | null)).toBeNull();
  });

  it('descarta datos con tipos o valores fuera de rango', () => {
    const base = JSON.parse(serializeDraft(draft())) as { data: Record<string, unknown> };
    const mutate = (patch: Record<string, unknown>) => JSON.stringify({ ...base, data: { ...base.data, ...patch } });
    expect(parseDraft(mutate({ step: 4 }))).toBeNull();
    expect(parseDraft(mutate({ businessType: 'gimnasio' }))).toBeNull();
    expect(parseDraft(mutate({ country: 'ZZ' }))).toBeNull();
    expect(parseDraft(mutate({ name: 42 }))).toBeNull();
    expect(parseDraft(mutate({ name: 'x'.repeat(81) }))).toBeNull();
    expect(parseDraft(mutate({ hours: { sameEveryDay: true, days: [] } }))).toBeNull();
  });

  it('hasUnsavedInput: solo cuenta texto escrito', () => {
    expect(hasUnsavedInput(emptyDraft())).toBe(false);
    expect(hasUnsavedInput({ ...emptyDraft(), country: 'MX', accepted: true, businessType: 'spa' })).toBe(false);
    expect(hasUnsavedInput({ ...emptyDraft(), city: '  ' })).toBe(false);
    expect(hasUnsavedInput({ ...emptyDraft(), phone: '3' })).toBe(true);
  });
});

describe('flagEmoji', () => {
  it('convierte el código de país en la bandera', () => {
    expect(flagEmoji('CO')).toBe('🇨🇴');
    expect(flagEmoji('US')).toBe('🇺🇸');
    for (const country of COUNTRIES) expect([...flagEmoji(country.code)]).toHaveLength(2);
  });
});

describe('contacto de soporte', () => {
  it('coincide con el número y correo oficiales y arma enlaces válidos', () => {
    expect(XIRO_CONTACT.whatsappDigits).toBe('573013059562');
    expect(supportWhatsappUrl()).toBe('https://wa.me/573013059562');
    expect(supportWhatsappUrl(supportMessage('es'))).toContain('?text=Hola%20Xiro');
    expect(supportMailtoUrl('Ayuda')).toBe('mailto:xirosoluciones.sas@gmail.com?subject=Ayuda');
  });
});
