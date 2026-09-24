import { describe, expect, it } from 'vitest';
import { syncInert } from '../src/web/shell/useInertHidden';

function scene(html: string, hidden: boolean) {
  const el = document.createElement('div');
  if (hidden) el.setAttribute('aria-hidden', 'true');
  el.innerHTML = html;
  return el;
}

describe('syncInert', () => {
  it('makes hidden scenes with focusable controls inert, and leaves visible/decorative ones alone', () => {
    const root = document.createElement('main');
    const hiddenWithButton = scene('<button>Ir</button>', true);
    const hiddenDecorative = scene('<span>solo texto</span>', true);
    const visible = scene('<button>Ver</button>', false);
    root.append(hiddenWithButton, hiddenDecorative, visible);

    syncInert(root);

    expect(hiddenWithButton.hasAttribute('inert')).toBe(true);
    expect(hiddenDecorative.hasAttribute('inert')).toBe(false);
    expect(visible.hasAttribute('inert')).toBe(false);
  });

  it('releases a scene when it becomes visible again, without touching foreign inert elements', () => {
    const root = document.createElement('main');
    const tab = scene('<a href="/x">x</a>', true);
    const foreign = scene('<button>b</button>', false);
    foreign.setAttribute('inert', '');
    root.append(tab, foreign);

    syncInert(root);
    expect(tab.hasAttribute('inert')).toBe(true);

    tab.removeAttribute('aria-hidden');
    syncInert(root);
    expect(tab.hasAttribute('inert')).toBe(false);
    expect(foreign.hasAttribute('inert')).toBe(true);
  });
});
