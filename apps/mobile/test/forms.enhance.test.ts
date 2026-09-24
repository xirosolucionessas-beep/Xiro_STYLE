import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInvalidFocuser, handleFormKeyDown, syncForms } from '../src/web/shell/formEnhance';

function el(tag: string, attrs: Record<string, string> = {}, ...children: Array<HTMLElement | string>): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) node.append(child);
  return node;
}
const radio = (text: string, checked?: boolean) => el('div', { role: 'radio', tabindex: '0', ...(checked === undefined ? {} : { 'aria-checked': String(checked) }) }, text);

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(root: HTMLElement) {
  document.body.append(root);
  return root;
}

describe('aria-checked safety net', () => {
  it('declares unchecked when a checkbox/radio has no state, keeps real state, and skips native inputs', () => {
    const undeclared = el('div', { role: 'checkbox', tabindex: '0' });
    const checked = el('div', { role: 'radio', 'aria-checked': 'true', tabindex: '0' });
    const nativeSwitch = el('input', { type: 'checkbox', role: 'switch' });
    const root = mount(el('main', {}, undeclared, checked, nativeSwitch));
    syncForms(root);
    expect(undeclared.getAttribute('aria-checked')).toBe('false');
    expect(checked.getAttribute('aria-checked')).toBe('true');
    expect(nativeSwitch.hasAttribute('aria-checked')).toBe(false);
  });
});

describe('radio groups (declared by the screens)', () => {
  const group = (label: string, ...children: HTMLElement[]) => el('div', { role: 'radiogroup', 'aria-label': label }, ...children);

  it('applies roving tabindex: only the checked radio is tabbable', () => {
    const row = group('Tipo', radio('Barbería', false), radio('Spa', true), radio('Otro', false));
    syncForms(mount(el('main', {}, row)));
    expect(Array.from(row.children).map((c) => c.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('makes the first radio tabbable when none is checked', () => {
    const row = group('Canal', radio('A', false), radio('B', false));
    syncForms(mount(el('main', {}, row)));
    expect(Array.from(row.children).map((c) => c.getAttribute('tabindex'))).toEqual(['0', '-1']);
  });

  it('ignores non-radio children inside a group (help or error text next to the options)', () => {
    const a = radio('Ana', false);
    const b = radio('Luis', true);
    const row = group('Cliente', a, b, el('p', {}, 'Sin número registrado'));
    syncForms(mount(el('main', {}, row)));
    expect([a, b].map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0']);
    expect(row.children).toHaveLength(3);
  });

  it('never invents groups: loose radios only get aria-checked', () => {
    const a = radio('Disponible', true);
    const container = el('div', {}, a, radio('Agotado', false), el('input', { type: 'text' }));
    syncForms(mount(el('main', {}, container)));
    expect(container.hasAttribute('role')).toBe(false);
    expect(a.getAttribute('aria-checked')).toBe('true');
    expect(a.getAttribute('tabindex')).toBe('0');
  });

  it('is idempotent', () => {
    const row = group('Grupo', radio('A', true), radio('B', false));
    const root = mount(el('main', {}, row));
    syncForms(root);
    const snapshot = root.innerHTML;
    syncForms(root);
    expect(root.innerHTML).toBe(snapshot);
  });
});

describe('keyboard', () => {
  function setup() {
    const a = radio('A', true);
    const b = radio('B', false);
    const c = radio('C', false);
    const row = el('div', { role: 'radiogroup', 'aria-label': 'Grupo' }, a, b, c, el('p', {}, 'ayuda'));
    const root = mount(el('main', {}, row));
    syncForms(root);
    root.addEventListener('keydown', handleFormKeyDown);
    const activations: string[] = [];
    for (const item of [a, b, c]) item.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && activations.push(item.textContent!));
    const press = (target: HTMLElement, key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    return { a, b, c, press, activations };
  }

  it('arrows move focus and select (with wrap), Home/End jump', () => {
    const { a, b, c, press, activations } = setup();
    a.focus();
    press(a, 'ArrowRight');
    expect(document.activeElement).toBe(b);
    press(b, 'ArrowDown');
    expect(document.activeElement).toBe(c);
    press(c, 'ArrowRight');
    expect(document.activeElement).toBe(a);
    press(a, 'ArrowLeft');
    expect(document.activeElement).toBe(c);
    press(c, 'Home');
    expect(document.activeElement).toBe(a);
    press(a, 'End');
    expect(document.activeElement).toBe(c);
    expect(activations).toEqual(['B', 'C', 'A', 'C', 'A', 'C']);
    // El único radio tabulable es siempre el enfocado (Tab justo después sale del grupo).
    expect([a, b, c].map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });

  it('Space activates radios and checkboxes (react-native-web only reacts to Enter)', () => {
    const { a, press, activations } = setup();
    const event = press(a, ' ');
    expect(event.defaultPrevented).toBe(true);
    expect(activations).toEqual(['A']);

    const box = el('div', { role: 'checkbox', tabindex: '0' });
    document.body.append(box);
    box.addEventListener('keydown', handleFormKeyDown);
    const spy = vi.fn();
    box.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && spy());
    box.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('never hijacks native inputs or unrelated keys', () => {
    const { a, press } = setup();
    const input = el('input', { type: 'checkbox', role: 'switch' });
    document.body.append(input);
    input.addEventListener('keydown', handleFormKeyDown);
    expect(press(input, ' ').defaultPrevented).toBe(false);
    expect(press(a, 'x').defaultPrevented).toBe(false);
  });
});

describe('focus first invalid field', () => {
  it('focuses the first invalid field after a failed submit, once per failure', () => {
    const first = el('input', { 'aria-invalid': 'false' });
    const second = el('input', { 'aria-invalid': 'false' });
    const submit = el('button', {}, 'Crear');
    const root = mount(el('main', {}, first, second, submit));
    const focusInvalid = createInvalidFocuser(root);

    submit.focus();
    focusInvalid(); // sin errores: nada
    expect(document.activeElement).toBe(submit);

    first.setAttribute('aria-invalid', 'true');
    second.setAttribute('aria-invalid', 'true');
    focusInvalid();
    expect(document.activeElement).toBe(first);

    // Ya hay errores: escribir en otro campo no le roba el foco.
    second.focus();
    focusInvalid();
    expect(document.activeElement).toBe(second);
  });

  it('does not steal focus while the person is typing in another field', () => {
    const typing = el('input');
    const bad = el('input', { 'aria-invalid': 'false' });
    const root = mount(el('main', {}, typing, bad));
    const focusInvalid = createInvalidFocuser(root);
    typing.focus();
    bad.setAttribute('aria-invalid', 'true');
    focusInvalid();
    expect(document.activeElement).toBe(typing);
  });
});
