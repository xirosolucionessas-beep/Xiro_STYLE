import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCss } from '../src/web/styles';
import { Button, Card, EmptyState, Input, Modal, Select, Skeleton, SkeletonGroup, ToastProvider, useToast } from '../src/web/ui';

/** axe en jsdom no calcula contraste (se cubre en tokens.contrast.test.ts); el resto de reglas WCAG sí aplican. */
async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

describe('Button', () => {
  it('is a real <button>, fires onPress and passes axe', async () => {
    const onPress = vi.fn();
    const { container } = render(<Button onPress={onPress}>Guardar</Button>);
    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveProperty('type', 'button');
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    await expectNoViolations(container);
  });

  it('while loading: announces busy, ignores clicks and stays focusable', async () => {
    const onPress = vi.fn();
    render(
      <Button loading loadingLabel="Cargando" onPress={onPress}>
        Guardar
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Guardar/ });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button).toHaveProperty('disabled', false);
    await userEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('disabled buttons are truly disabled', () => {
    render(<Button disabled>Guardar</Button>);
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveProperty('disabled', true);
  });
});

describe('Input', () => {
  function Controlled(props: { error?: string; hint?: string; type?: string }) {
    const [value, setValue] = useState('');
    return <Input label="Correo electrónico" value={value} onChange={setValue} name="email" autoComplete="email" inputMode="email" required {...props} />;
  }

  it('associates <label for>, exposes required/autocomplete/inputmode and passes axe', async () => {
    const { container } = render(<Controlled type="email" />);
    const input = screen.getByLabelText(/Correo electrónico/);
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('type')).toBe('email');
    expect(input.getAttribute('autocomplete')).toBe('email');
    expect(input.getAttribute('inputmode')).toBe('email');
    expect(input.getAttribute('aria-required')).toBe('true');
    await userEvent.type(input, 'ana@correo.com');
    expect(input).toHaveProperty('value', 'ana@correo.com');
    await expectNoViolations(container);
  });

  it('links hint and error with aria-describedby, marks aria-invalid and uses a live region', () => {
    const { rerender } = render(<Input label="Teléfono" value="" onChange={() => undefined} hint="Con indicativo" />);
    const input = screen.getByLabelText('Teléfono');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    const live = document.querySelector('.xw-error')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('');

    rerender(<Input label="Teléfono" value="" onChange={() => undefined} hint="Con indicativo" error="Ingresa un número válido." />);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    const messages = described.map((id) => document.getElementById(id)!.textContent);
    expect(messages).toContain('Con indicativo');
    expect(messages).toContain('Ingresa un número válido.');
    // El estado de error no depende solo del color: hay icono + texto.
    expect(live.querySelector('svg')).not.toBeNull();
  });

  it('password toggle is a labelled pressed-state button', async () => {
    render(<Controlled type="password" />);
    const input = screen.getByLabelText(/Correo electrónico/);
    expect(input.getAttribute('type')).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);
    expect(input.getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('supports multiline with the same label wiring', () => {
    render(<Input label="Notas" value="" onChange={() => undefined} multiline />);
    expect(screen.getByLabelText('Notas').tagName).toBe('TEXTAREA');
  });
});

describe('Select', () => {
  it('is a native <select> with a label, options and axe-clean', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Select label="Moneda" value="COP" onChange={onChange} options={[{ value: 'COP', label: 'Peso colombiano' }, { value: 'USD', label: 'Dólar' }]} />,
    );
    const select = screen.getByLabelText('Moneda');
    expect(select.tagName).toBe('SELECT');
    await userEvent.selectOptions(select, 'USD');
    expect(onChange).toHaveBeenCalledWith('USD');
    await expectNoViolations(container);
  });
});

describe('Card', () => {
  it('renders links and buttons as real interactive elements', async () => {
    const onPress = vi.fn();
    render(
      <>
        <Card href="/clientes">Clientes</Card>
        <Card onPress={onPress}>Nuevo</Card>
        <Card as="section">Estático</Card>
      </>,
    );
    expect(screen.getByRole('link', { name: 'Clientes' }).getAttribute('href')).toBe('/clientes');
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByText('Estático').tagName).toBe('SECTION');
  });
});

describe('Modal', () => {
  function Harness({ onClosed }: { onClosed?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <main>
          <button onClick={() => setOpen(true)}>Abrir</button>
        </main>
        <Modal
          open={open}
          onClose={() => {
            setOpen(false);
            onClosed?.();
          }}
          title="Nuevo cliente"
          footer={<button>Guardar</button>}>
          <label>
            Nombre <input />
          </label>
        </Modal>
      </div>
    );
  }

  it('exposes dialog semantics, moves focus inside and is axe-clean', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuevo cliente' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await expectNoViolations(document.body);
  });

  it('traps focus with Tab and Shift+Tab', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    const focusables = within(dialog).getAllByRole('button').concat(within(dialog).getAllByRole('textbox'));
    expect(focusables.length).toBeGreaterThan(2);
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `Tab #${i + 1} salió del diálogo`).toBe(true);
    }
    for (let i = 0; i < 8; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement), `Shift+Tab #${i + 1} salió del diálogo`).toBe(true);
    }
  });

  it('closes with Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('hides the rest of the page from assistive tech and locks scroll while open, then restores both', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const page = screen.getByRole('main').parentElement!.parentElement!;
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(page.getAttribute('aria-hidden')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(page.getAttribute('aria-hidden')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes from the close button and by clicking the backdrop', async () => {
    const user = userEvent.setup();
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    fireEvent.mouseDown(document.querySelector('.xw-backdrop')!);
    expect(onClosed).toHaveBeenCalledTimes(2);
  });
});

describe('Toast', () => {
  afterEach(() => vi.useRealTimers());

  function Trigger() {
    const toast = useToast();
    return (
      <>
        <button onClick={() => toast.show('Guardado', { tone: 'success' })}>ok</button>
        <button onClick={() => toast.show('No se pudo guardar', { tone: 'error' })}>fail</button>
      </>
    );
  }

  it('announces success politely (role=status) and errors assertively (role=alert)', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    const status = screen.getByRole('status');
    const alert = screen.getByRole('alert');
    expect(status.textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'ok' }));
    await user.click(screen.getByRole('button', { name: 'fail' }));
    expect(within(status).getByText('Guardado')).toBeTruthy();
    expect(within(alert).getByText('No se pudo guardar')).toBeTruthy();
    await expectNoViolations(container);
  });

  it('auto-dismisses success but keeps errors until closed; pauses on hover', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    fireEvent.click(screen.getByRole('button', { name: 'fail' }));

    const success = screen.getByText('Guardado').closest('.xw-toast')!;
    fireEvent.mouseEnter(success);
    act(() => void vi.advanceTimersByTime(20_000));
    expect(screen.queryByText('Guardado')).not.toBeNull();

    fireEvent.mouseLeave(success);
    act(() => void vi.advanceTimersByTime(6_100));
    expect(screen.queryByText('Guardado')).toBeNull();
    expect(screen.queryByText('No se pudo guardar')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByText('No se pudo guardar')).toBeNull();
  });
});

describe('EmptyState and Skeleton', () => {
  it('EmptyState uses a real heading at the requested level', async () => {
    const { container } = render(<EmptyState title="Aún no tienes clientes" description="Crea el primero." headingLevel={2} action={<Button>Nuevo cliente</Button>} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Aún no tienes clientes' })).toBeTruthy();
    await expectNoViolations(container);
  });

  it('SkeletonGroup announces loading once and hides the blocks', async () => {
    const { container } = render(
      <SkeletonGroup label="Cargando clientes">
        <Skeleton />
        <Skeleton height={40} />
      </SkeletonGroup>,
    );
    const group = screen.getByRole('status');
    expect(group.getAttribute('aria-busy')).toBe('true');
    expect(within(group).getByText('Cargando clientes')).toBeTruthy();
    expect(container.querySelectorAll('.xw-skeleton[aria-hidden="true"]')).toHaveLength(2);
    await expectNoViolations(container);
  });
});

describe('global CSS', () => {
  const css = buildCss();
  it('defines a 2px accent focus ring on interactive elements', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline: 2px solid var\(--xw-focus\)/);
  });
  it('honours prefers-reduced-motion and forced-colors', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (forced-colors: active)');
  });
  it('sizes controls to at least 44px and uses rem so text zoom scales', () => {
    expect(css).toContain('--xw-touch: 2.75rem');
    expect(css).toMatch(/\.xw-btn \{[^}]*min-height: var\(--xw-touch\)/);
    expect(css).not.toMatch(/font-size:\s*\d+px/);
  });
  it('defines both themes as CSS variables', () => {
    expect(css).toContain(":root[data-theme='light']");
    expect(css).toContain('--xw-accent:');
  });
});
