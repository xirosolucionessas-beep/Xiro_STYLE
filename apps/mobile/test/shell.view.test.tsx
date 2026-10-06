import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { describeRoute } from '../src/web/shell/routes';
import { ShellView, type ShellMode, type ShellStatus } from '../src/web/shell/ShellView';
import { tw } from '../src/web/shell/strings';

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

interface HarnessProps {
  mode?: ShellMode;
  path?: string;
  signedIn?: boolean;
  collapsed?: boolean;
  navigate?: (href: string) => void;
  onToggle?: () => void;
  announcement?: string;
  slots?: boolean;
}

function Harness({ mode = 'desktop', path = '/inventory', signedIn = true, collapsed = false, navigate = () => undefined, onToggle = () => undefined, announcement = '', slots = false }: HarnessProps) {
  const mainRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <ShellView
      mode={mode}
      collapsed={collapsed}
      onToggleCollapsed={onToggle}
      route={describeRoute(path)}
      t={(key) => tw('es', key)}
      signedIn={signedIn}
      brand={{ name: 'Studio Ana', logo: null }}
      navigate={navigate}
      drawerOpen={open}
      onDrawerOpenChange={setOpen}
      announcement={announcement}
      mainRef={mainRef}
      headerSearch={slots ? <input aria-label="Buscar" /> : undefined}
      headerTools={slots ? <button>Campana</button> : undefined}
      sidebarExtra={slots ? <p>Tarjeta del plan</p> : undefined}>
      <h1>Inventario</h1>
      <button>Contenido</button>
    </ShellView>
  );
}

describe('ShellView — desktop', () => {
  it('exposes real landmarks (banner, two labelled navs, main) and passes axe', async () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Ruta de navegación' })).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    await expectNoViolations(container);
  });

  it('marks only the active section with aria-current and the last breadcrumb as the page', () => {
    render(<Harness path="/item/abc" />);
    const sidebar = screen.getByRole('navigation', { name: 'Navegación principal' });
    const current = within(sidebar).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['Inventario']);
    const crumbs = screen.getByRole('navigation', { name: 'Ruta de navegación' });
    expect(within(crumbs).getByText('Ficha').getAttribute('aria-current')).toBe('page');
    expect(within(crumbs).getByRole('link', { name: 'Inventario' }).getAttribute('href')).toBe('/inventory');
  });

  it('lists every module as a real link, including Citas and Reportes', () => {
    render(<Harness />);
    const sidebar = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(sidebar).getByRole('link', { name: 'Citas' }).getAttribute('href')).toBe('/agenda');
    expect(within(sidebar).getByRole('link', { name: 'Reportes' }).getAttribute('href')).toBe('/reports');
  });

  it('navigates client-side on plain clicks but lets modified clicks open new tabs', async () => {
    const navigate = vi.fn();
    render(<Harness navigate={navigate} />);
    const link = screen.getByRole('link', { name: 'Clientes' });
    expect(link.getAttribute('href')).toBe('/clients');
    await userEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/clients');
    navigate.mockClear();
    let prevented: boolean | undefined;
    const spy = (event: Event) => {
      prevented = event.defaultPrevented;
      event.preventDefault(); // evita la navegación real de jsdom tras medir
    };
    document.addEventListener('click', spy);
    fireEvent.click(link, { ctrlKey: true });
    document.removeEventListener('click', spy);
    expect(navigate).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it('collapse button exposes aria-expanded/aria-controls and toggles', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Harness onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: 'Contraer barra lateral' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe('xw-sidebar');
    expect(document.getElementById('xw-sidebar')).toBeTruthy();
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalled();
    rerender(<Harness collapsed onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'Expandir barra lateral' }).getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('xw-sidebar')!.getAttribute('data-collapsed')).toBe('true');
  });

  it('skip link moves focus to <main>', async () => {
    render(<Harness />);
    const skip = screen.getByRole('link', { name: 'Saltar al contenido' });
    await userEvent.click(skip);
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('skip link is the first tab stop', async () => {
    render(<Harness />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Saltar al contenido' }));
  });

  it('adds a hidden h1 only on the home page and sets the page width variable', () => {
    const { unmount } = render(<Harness path="/" />);
    expect(screen.getAllByRole('heading', { level: 1 }).some((h) => h.textContent === 'Inicio' && h.classList.contains('xw-sr'))).toBe(true);
    unmount();
    render(<Harness path="/business" />);
    expect(screen.getAllByRole('heading', { level: 1 }).some((h) => h.classList.contains('xw-sr'))).toBe(false);
    expect((screen.getByRole('main') as HTMLElement).style.getPropertyValue('--xw-page-max')).toBe('40rem');
  });

  it('announces page changes in a polite live region', () => {
    render(<Harness announcement="Clientes" />);
    const live = screen.getAllByRole('status').find((el) => el.textContent === 'Clientes')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
  });
});

describe('ShellView — tablet (icons only)', () => {
  it('shows labels only to screen readers, no collapse button, and a keyboard/hover tooltip dismissible with Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="tablet" />);
    expect(screen.queryByRole('button', { name: /barra lateral/ })).toBeNull();
    expect(document.getElementById('xw-sidebar')!.getAttribute('data-collapsed')).toBe('true');
    const link = screen.getByRole('link', { name: 'Clientes' });
    expect(link.querySelector('.xw-sr')?.textContent).toBe('Clientes');
    expect(container.querySelector('.xw-tip')).toBeNull();

    act(() => link.focus());
    expect(container.querySelector('.xw-tip')?.textContent).toBe('Clientes');
    expect(container.querySelector('.xw-tip')?.getAttribute('aria-hidden')).toBe('true');
    await user.keyboard('{Escape}');
    expect(container.querySelector('.xw-tip')).toBeNull();

    await user.hover(screen.getByRole('link', { name: 'Catálogo' }));
    expect(container.querySelector('.xw-tip')?.textContent).toBe('Catálogo');
    // Solo puntero (sin foco en el control): Escape también lo descarta (WCAG 1.4.13).
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Escape}');
    expect(container.querySelector('.xw-tip')).toBeNull();
    await expectNoViolations(container);
  });
});

describe('ShellView — mobile (drawer)', () => {
  it('has a hamburger with aria-expanded/controls and no persistent sidebar', () => {
    render(<Harness mode="mobile" />);
    const menu = screen.getByRole('button', { name: 'Abrir menú' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-controls')).toBe('xw-drawer');
    expect(document.getElementById('xw-sidebar')).toBeNull();
  });

  it('opens a labelled, focus-trapped drawer, closes with Escape and returns focus to the hamburger', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness mode="mobile" />);
    const menu = screen.getByRole('button', { name: 'Abrir menú' });
    await user.click(menu);

    const drawer = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(drawer.id).toBe('xw-drawer');
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(container.getAttribute('aria-hidden')).toBe('true');

    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(drawer.contains(document.activeElement), `Tab #${i + 1}`).toBe(true);
    }
    await user.tab({ shift: true });
    expect(drawer.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Navegación principal' })).toBeNull();
    expect(document.activeElement).toBe(menu);
    expect(container.getAttribute('aria-hidden')).toBeNull();
  });

  it('closes after choosing a destination', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<Harness mode="mobile" navigate={navigate} />);
    await user.click(screen.getByRole('button', { name: 'Abrir menú' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Navegación principal' })).getByRole('link', { name: 'Clientes' }));
    expect(navigate).toHaveBeenCalledWith('/clients');
    expect(screen.queryByRole('navigation', { name: 'Navegación principal' })).toBeNull();
  });

  it('drawer is axe-clean', async () => {
    render(<Harness mode="mobile" />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    await expectNoViolations(document.body);
  });
});

describe('ShellView — header tools and sidebar card', () => {
  it('shows search and tools in the top bar (inside the banner) and the plan card in the sidebar', () => {
    render(<Harness slots />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('textbox', { name: 'Buscar' })).toBeTruthy();
    expect(within(banner).getByRole('button', { name: 'Campana' })).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Navegación principal' })).getByText('Tarjeta del plan')).toBeTruthy();
  });

  it('hides the sidebar card when the sidebar is icons-only, and shows nothing when signed out', () => {
    const collapsed = render(<Harness slots collapsed />);
    expect(screen.queryByText('Tarjeta del plan')).toBeNull();
    collapsed.unmount();
    render(<Harness slots signedIn={false} path="/login" />);
    expect(screen.queryByRole('button', { name: 'Campana' })).toBeNull();
  });

  it('on mobile the tools live in the top bar and there is no persistent sidebar card', () => {
    render(<Harness slots mode="mobile" />);
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Campana' })).toBeTruthy();
    expect(screen.queryByText('Tarjeta del plan')).toBeNull();
  });
});

describe('ShellView — páginas legales con sesión iniciada', () => {
  it('Términos y Privacidad van a ventana completa (sin barra lateral ni migas) aunque haya sesión', () => {
    render(<Harness path="/terms" signedIn />);
    expect(screen.queryByRole('navigation', { name: 'Navegación principal' })).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByRole('main')).toBeTruthy();
  });
});

describe('ShellView — signed out', () => {
  it('renders no navigation chrome, only skip link and <main> at the narrow auth width', async () => {
    const { container } = render(<Harness signedIn={false} path="/register" />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect((screen.getByRole('main') as HTMLElement).style.getPropertyValue('--xw-page-max')).toBe('30rem');
    await expectNoViolations(container);
  });
});

describe('ShellView — data status (loading bar and error with retry)', () => {
  function withStatus(status: ShellStatus, path = '/clients') {
    const mainRef = { current: null };
    return (
      <ShellView
        mode="desktop"
        collapsed={false}
        onToggleCollapsed={() => undefined}
        route={describeRoute(path)}
        t={(key) => tw('es', key)}
        signedIn
        brand={{ name: 'Studio', logo: null }}
        navigate={() => undefined}
        drawerOpen={false}
        onDrawerOpenChange={() => undefined}
        announcement=""
        mainRef={mainRef}
        status={status}>
        <h1>Clientes</h1>
      </ShellView>
    );
  }

  it('shows a decorative loading bar while fetching', () => {
    const { container } = render(withStatus({ busy: true }));
    expect(container.querySelector('.xw-progress')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('announces a failed query as an alert with an actionable Retry button, and passes axe', async () => {
    const onRetry = vi.fn();
    const { container } = render(withStatus({ busy: false, error: { message: 'No pudimos conectar con el servidor.', retryLabel: 'Reintentar', onRetry } }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No pudimos conectar con el servidor.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await expectNoViolations(container);
  });

  it('does not duplicate the banner on screens that render their own error + retry', () => {
    render(withStatus({ busy: false, error: { message: 'Error', retryLabel: 'Reintentar', onRetry: () => undefined } }, '/inventory'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
