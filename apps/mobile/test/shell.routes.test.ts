import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '../src/web/shell/nav';
import { describeRoute } from '../src/web/shell/routes';
import { tw } from '../src/web/shell/strings';

describe('describeRoute', () => {
  it('marks the active section for each main area and its detail pages', () => {
    const cases: Array<[string, string | null]> = [
      ['/', 'home'],
      ['/cash-opening', 'home'],
      ['/clients', 'clients'],
      ['/client/abc', 'clients'],
      ['/client/form', 'clients'],
      ['/catalog', 'services'],
      ['/catalog-item/abc', 'services'],
      ['/share', 'services'],
      ['/inventory', 'inventory'],
      ['/item/abc', 'inventory'],
      ['/item/form', 'inventory'],
      ['/more', 'settings'],
      ['/categories', 'settings'],
      ['/business', 'settings'],
      ['/profile', 'settings'],
      ['/login', null],
    ];
    for (const [path, section] of cases) expect(describeRoute(path).section, path).toBe(section);
  });

  it('builds breadcrumb trails whose parents are links and last item is the page', () => {
    const route = describeRoute('/item/abc');
    expect(route.trail.map((c) => c.labelKey)).toEqual(['nav_home', 'nav_inventory', 'crumb_detail']);
    expect(route.trail.slice(0, -1).every((c) => c.href)).toBe(true);
    expect(route.trail.at(-1)!.href).toBeUndefined();
  });

  it('distinguishes creating from editing by the id parameter', () => {
    expect(describeRoute('/item/form').titleKey).toBe('item_new');
    expect(describeRoute('/item/form', '?id=1').titleKey).toBe('item_edit');
    expect(describeRoute('/client/form', '?id=1').titleKey).toBe('client_edit');
  });

  it('flags auth pages (no sidebar, narrow) and pages that need a shell heading', () => {
    expect(describeRoute('/register')).toMatchObject({ auth: true, width: 'form' });
    expect(describeRoute('/').needsHeading).toBe(true);
    expect(describeRoute('/welcome').needsHeading).toBe(false); // trae su propio <h1> en la tarjeta
    expect(describeRoute('/welcome').bleed).toBe(true);
    expect(describeRoute('/login').needsHeading).toBe(false);
    expect(describeRoute('/inventory').needsHeading).toBe(false);
  });

  it('gives forms a reading width and lists a wide one', () => {
    expect(describeRoute('/business').width).toBe('form');
    expect(describeRoute('/inventory').width).toBe('wide');
  });

  it('marks the screens that already render their own error and retry', () => {
    expect(describeRoute('/inventory').inlineErrors).toBe(true);
    expect(describeRoute('/catalog').inlineErrors).toBe(true);
    expect(describeRoute('/clients').inlineErrors).toBeFalsy();
    expect(describeRoute('/item/abc').inlineErrors).toBeFalsy();
  });

  it('tolerates trailing slashes and unknown paths', () => {
    expect(describeRoute('/inventory/').section).toBe('inventory');
    expect(describeRoute('/nope')).toMatchObject({ section: null, auth: false });
  });
});

describe('navigation config', () => {
  it('has real links only for available modules and marks the rest as coming soon', () => {
    const soon = NAV_ITEMS.filter((item) => item.soon).map((item) => item.id);
    expect(soon).toEqual(['agenda', 'reports']);
    for (const item of NAV_ITEMS) expect(Boolean(item.href), item.id).toBe(!item.soon);
  });

  it('every nav label exists in both languages', () => {
    for (const item of NAV_ITEMS) {
      expect(tw('es', item.labelKey)).not.toBe(item.labelKey);
      expect(tw('en', item.labelKey)).not.toBe(item.labelKey);
    }
  });
});
