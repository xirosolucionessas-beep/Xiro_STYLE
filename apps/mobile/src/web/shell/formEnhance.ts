/**
 * Mejoras de accesibilidad de formularios aplicadas sobre el DOM que genera react-native-web, para pantallas
 * compartidas que no podemos editar (solo web). Todo es idempotente: se puede ejecutar en cada mutación.
 *
 *  1. role="radio" / "checkbox": garantiza `aria-checked` (el estado real lo aporta src/web/rn; aquí solo una red de seguridad).
 *  2. Radiogroups (declarados por las pantallas con `role="radiogroup"` + nombre): tabulación "roving" y flechas.
 *  3. Espacio activa radios/casillas (react-native-web solo activa con Enter).
 *  4. Tras un envío fallido, el foco va al primer campo inválido.
 */

const setAttr = (element: Element, name: string, value: string) => {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

function syncChecked(root: HTMLElement): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[role="radio"],[role="checkbox"],[role="switch"]'))) {
    // Red de seguridad: un control con rol de casilla/radio sin estado declarado se anuncia como "no marcado".
    if (element.tagName !== 'INPUT' && !element.hasAttribute('aria-checked')) setAttr(element, 'aria-checked', 'false');
  }
}

/** Radios que son hijos directos del grupo (el grupo puede contener además textos de ayuda o error). */
const radiosOf = (group: Element) => Array.from(group.querySelectorAll<HTMLElement>(':scope > [role="radio"]'));

/** Tabulación "roving": solo el radio marcado (o el primero) entra en el orden de Tab; el resto se alcanza con flechas. */
function syncGroups(root: HTMLElement): void {
  for (const group of Array.from(root.querySelectorAll<HTMLElement>('[role="radiogroup"]'))) {
    const radios = radiosOf(group);
    if (radios.length === 0) continue;
    const current = radios.find((radio) => radio.getAttribute('aria-checked') === 'true') ?? radios[0]!;
    for (const radio of radios) setAttr(radio, 'tabindex', radio === current ? '0' : '-1');
  }
}

/** Activa un elemento como lo haría un Enter (react-native-web dispara onPress con Enter). */
function activate(element: HTMLElement): void {
  for (const type of ['keydown', 'keyup'] as const) {
    element.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', bubbles: true, cancelable: true }));
  }
}

export function handleFormKeyDown(event: KeyboardEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const role = target.getAttribute('role');
  if (role !== 'radio' && role !== 'checkbox' && role !== 'switch') return;
  // Los <input> nativos (Switch) ya se activan con Espacio; solo se completan los Pressable de react-native-web.
  if (target.tagName === 'INPUT') return;

  if (event.key === ' ') {
    event.preventDefault();
    activate(target);
    return;
  }

  const group = target.closest('[role="radiogroup"]');
  if (role !== 'radio' || !group) return;
  const radios = radiosOf(group);
  const index = radios.indexOf(target);
  if (index < 0) return;
  let next = -1;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % radios.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + radios.length) % radios.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = radios.length - 1;
  if (next < 0) return;

  event.preventDefault();
  const destination = radios[next]!;
  // Roving tabindex inmediato: si la persona pulsa Tab justo después, sale del grupo desde el radio nuevo.
  for (const radio of radios) setAttr(radio, 'tabindex', radio === destination ? '0' : '-1');
  destination.focus();
  activate(destination); // en un radiogroup las flechas mueven el foco Y seleccionan (APG)
}

/** Devuelve una función que, tras un envío fallido, enfoca el primer campo inválido. */
export function createInvalidFocuser(root: HTMLElement): () => void {
  let previous = 0;
  return () => {
    const invalid = root.querySelectorAll<HTMLElement>('[aria-invalid="true"]');
    if (invalid.length > 0 && previous === 0) {
      const active = document.activeElement;
      const fromSubmit = !active || active === document.body || active.tagName === 'BUTTON' || active.getAttribute('role') === 'button';
      if (fromSubmit) invalid[0]!.focus();
    }
    previous = invalid.length;
  };
}

export function syncForms(root: HTMLElement): void {
  syncChecked(root);
  syncGroups(root);
}
