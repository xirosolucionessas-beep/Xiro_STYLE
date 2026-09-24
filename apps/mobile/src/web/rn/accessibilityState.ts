/**
 * React Native describe el estado de un control con `accessibilityState={{ checked, selected, expanded, disabled, busy }}`.
 * react-native-web 0.21 solo entiende las props ARIA planas, así que ese estado nunca llegaba al DOM y los lectores de
 * pantalla no sabían qué radio/casilla/pestaña estaba marcada. Este adaptador (solo web) lo traduce a `aria-*`.
 */

export interface RNAccessibilityState {
  checked?: boolean | 'mixed';
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  busy?: boolean;
}

type Props = Record<string, unknown> & { accessibilityState?: RNAccessibilityState; role?: string; accessibilityRole?: string };

const CHECKABLE = new Set(['radio', 'checkbox', 'switch', 'menuitemcheckbox', 'menuitemradio']);

export function adaptAccessibilityState<P extends Props>(props: P): P {
  const state = props.accessibilityState;
  if (!state) return props;

  const { accessibilityState: _removed, ...rest } = props;
  void _removed;
  const out: Record<string, unknown> = { ...rest };
  const role = props.role ?? props.accessibilityRole;
  const set = (name: string, value: unknown) => {
    if (value !== undefined && out[name] === undefined) out[name] = value;
  };

  set('aria-checked', state.checked);
  if (state.selected !== undefined) set(role && CHECKABLE.has(role) ? 'aria-checked' : 'aria-selected', state.selected);
  set('aria-expanded', state.expanded);
  set('aria-disabled', state.disabled);
  set('aria-busy', state.busy);
  return out as P;
}
