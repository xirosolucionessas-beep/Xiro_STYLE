import { describe, expect, it } from 'vitest';
import { adaptAccessibilityState } from '../src/web/rn/accessibilityState';

describe('adaptAccessibilityState', () => {
  it('returns props untouched when there is no accessibilityState', () => {
    const props = { role: 'button', onPress: () => undefined };
    expect(adaptAccessibilityState(props)).toBe(props);
  });

  it('maps checked/selected to aria-checked on checkable roles and removes the RN-only object', () => {
    expect(adaptAccessibilityState({ accessibilityRole: 'checkbox', accessibilityState: { checked: true } })).toEqual({ accessibilityRole: 'checkbox', 'aria-checked': true });
    expect(adaptAccessibilityState({ accessibilityRole: 'radio', accessibilityState: { selected: false } })).toEqual({ accessibilityRole: 'radio', 'aria-checked': false });
    expect(adaptAccessibilityState({ role: 'switch', accessibilityState: { checked: false } })).toEqual({ role: 'switch', 'aria-checked': false });
  });

  it('maps selected to aria-selected on non-checkable roles', () => {
    expect(adaptAccessibilityState({ role: 'tab', accessibilityState: { selected: true } })).toEqual({ role: 'tab', 'aria-selected': true });
  });

  it('maps expanded, disabled and busy', () => {
    expect(adaptAccessibilityState({ accessibilityState: { expanded: true, disabled: true, busy: false } })).toEqual({ 'aria-expanded': true, 'aria-disabled': true, 'aria-busy': false });
  });

  it('never overrides an explicit aria-* prop', () => {
    expect(adaptAccessibilityState({ role: 'radio', 'aria-checked': true, accessibilityState: { selected: false } })).toEqual({ role: 'radio', 'aria-checked': true });
  });
});
