import type { Actor } from '@xiro/shared';
import { render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { actorOf, meets, routeRequirement } from '../src/lib/access';
import { NAV_ITEMS } from '../src/web/shell/nav';
import { describeRoute } from '../src/web/shell/routes';
import { ShellView } from '../src/web/shell/ShellView';
import { tw } from '../src/web/shell/strings';

const owner = { role: 'owner' as const, permissions: [] };
const employee = (...permissions: Array<'clients_view' | 'clients_manage' | 'catalog_view' | 'catalog_manage' | 'services_record' | 'loyalty_redeem'>) => ({ role: 'employee' as const, permissions });

describe('meets', () => {
  it('sin requisito o sin actor (sesión cargando) no oculta nada', () => {
    expect(meets(employee(), undefined)).toBe(true);
    expect(meets(null, 'owner')).toBe(true);
  });
  it('"owner" solo para el dueño; una lista de permisos, para el dueño o quien tenga alguno', () => {
    expect(meets(owner, 'owner')).toBe(true);
    expect(meets(employee('clients_manage'), 'owner')).toBe(false);
    expect(meets(employee('clients_view'), ['clients_view'])).toBe(true);
    expect(meets(employee('catalog_view'), ['clients_view'])).toBe(false);
    expect(meets(employee('services_record'), ['loyalty_redeem', 'services_record'])).toBe(true);
    expect(meets(owner, ['catalog_manage'])).toBe(true);
  });
});

describe('routeRequirement', () => {
  it.each([
    ['/', undefined],
    ['/more', undefined],
    ['/profile', undefined],
    ['/clients', ['clients_view']],
    ['/clients/', ['clients_view']],
    ['/client/form', ['clients_manage']],
    ['/client/abc', ['clients_view']],
    ['/catalog', ['catalog_view']],
    ['/item/form', ['catalog_manage']],
    ['/item/abc', ['catalog_view']],
    ['/categories', ['catalog_manage']],
    ['/loyalty', ['loyalty_redeem', 'services_record']],
    ['/employees', 'owner'],
    ['/business', 'owner'],
    ['/subscription', 'owner'],
    ['/cash-opening', 'owner'],
  ])('%s', (path, expected) => {
    expect(routeRequirement(path)).toEqual(expected);
  });

  it('todas las pantallas del menú piden lo mismo que su ruta (menú y guardián no se contradicen)', () => {
    for (const item of NAV_ITEMS) {
      if (!item.href) continue;
      expect(routeRequirement(item.href), item.id).toEqual(item.requires);
    }
  });

  it('actorOf adapta al usuario de la sesión', () => {
    expect(actorOf(null)).toBeNull();
    expect(actorOf({ role: 'employee', permissions: ['clients_view'] })).toEqual({ role: 'employee', permissions: ['clients_view'] });
  });
});

function Shell({ actor }: { actor?: Actor | null }) {
  const mainRef = useRef<HTMLElement>(null);
  return (
    <ShellView mode="desktop" collapsed={false} onToggleCollapsed={() => undefined} route={describeRoute('/')} t={(key) => tw('es', key)} signedIn actor={actor} brand={{ name: 'Studio', logo: null }} navigate={() => undefined} drawerOpen={false} onDrawerOpenChange={() => undefined} announcement="" mainRef={mainRef}>
      <p>contenido</p>
    </ShellView>
  );
}
const menu = () => within(screen.getByRole('navigation', { name: 'Navegación principal' }));

describe('menú lateral por rol', () => {
  it('el dueño ve todo, incluido Empleados', () => {
    render(<Shell actor={owner} />);
    for (const name of ['Inicio', 'Clientes', 'Servicios', 'Inventario', 'Empleados', 'Fidelización', 'Ajustes']) expect(menu().getByRole('link', { name })).toBeTruthy();
  });

  it('un empleado sin permisos solo ve Inicio y Ajustes (nada de Próximamente del dueño)', () => {
    render(<Shell actor={employee()} />);
    expect(menu().getAllByRole('link').map((l) => l.textContent)).toEqual(['Inicio', 'Ajustes']);
    expect(menu().queryByText('Próximamente')).toBeNull();
  });

  it('cada permiso abre su módulo y solo ese', () => {
    render(<Shell actor={employee('clients_view', 'catalog_view', 'services_record')} />); // como lo entrega el servidor: ya normalizado
    const names = menu().getAllByRole('link').map((l) => l.textContent);
    expect(names).toEqual(expect.arrayContaining(['Clientes', 'Servicios', 'Inventario', 'Fidelización']));
    expect(names).not.toContain('Empleados');
  });

  it('sin actor (aún cargando la sesión) no se oculta nada', () => {
    render(<Shell />);
    expect(menu().getByRole('link', { name: 'Empleados' })).toBeTruthy();
  });
});
