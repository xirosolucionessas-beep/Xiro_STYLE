import { useEffect, type RefObject } from 'react';
import { createInvalidFocuser, handleFormKeyDown, syncForms } from './formEnhance';

/** Aplica formEnhance a todo el <main> y lo mantiene al día cuando react-native-web cambia el DOM. */
export function useFormEnhancements(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const focusInvalid = createInvalidFocuser(root);
    let frame = 0;
    const run = () => {
      syncForms(root);
      focusInvalid();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    };

    run();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked', 'aria-invalid', 'role'] });
    root.addEventListener('keydown', handleFormKeyDown);

    return () => {
      observer.disconnect();
      root.removeEventListener('keydown', handleFormKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [rootRef]);
}
