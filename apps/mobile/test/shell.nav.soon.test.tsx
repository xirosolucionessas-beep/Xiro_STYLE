import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { describeRoute } from '../src/web/shell/routes';
import { ShellView } from '../src/web/shell/ShellView';
import { tw } from '../src/web/shell/strings';

// Hoy ningún módulo del menú es "próximamente" (Citas tiene su propia página), pero el menú sigue soportando el estado
// para módulos futuros: se prueba con un menú simulado.
vi.mock('../src/web/shell/nav', () => ({
  NAV_ITEMS: [
    { id: 'home', labelKey: 'nav_home', icon: 'home', section: 'home', href: '/' },
    { id: 'agenda', labelKey: 'nav_agenda', icon: 'calendar', soon: true },
  ],
}));

function Harness() {
  const mainRef = useRef<HTMLElement>(null);
  return (
    <ShellView mode="desktop" collapsed={false} onToggleCollapsed={() => undefined} route={describeRoute('/')} t={(key) => tw('es', key)} signedIn brand={{ name: 'Studio Ana' }} navigate={() => undefined} drawerOpen={false} onDrawerOpenChange={() => undefined} announcement="" mainRef={mainRef}>
      <p>Contenido</p>
    </ShellView>
  );
}

describe('ShellView — módulo aún no disponible en el menú', () => {
  it('se muestra sin enlace, sin foco y anunciado como próximamente', () => {
    render(<Harness />);
    const item = screen.getByText('Citas').closest('.xw-nav-item')!;
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('href')).toBeNull();
    expect(item.getAttribute('tabindex')).toBeNull();
    expect(item.textContent).toContain('Próximamente');
  });
});
