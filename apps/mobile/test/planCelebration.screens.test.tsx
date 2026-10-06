import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { PlanCelebration } from '../src/web/ui/PlanCelebration';
import { tw } from '../src/web/shell/strings';

const t = (key: string, params?: Record<string, string | number>) => tw('es', key, params);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

describe('PlanCelebration', () => {
  it('cerrada, no renderiza nada', () => {
    const { container } = render(<PlanCelebration open={false} onClose={vi.fn()} t={t} planLabel="Anual" renewalDate="30 de octubre" />);
    expect(container.textContent).toBe('');
  });

  it('abierta, anuncia el plan y la fecha de renovación, y "Continuar" llama a onClose', async () => {
    const onClose = vi.fn();
    const { baseElement } = render(<PlanCelebration open onClose={onClose} t={t} planLabel="Anual" renewalDate="30 de octubre" />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('¡Bienvenido a Xiro Premium!')).toBeTruthy();
    expect(screen.getByText('Tu plan Anual ya está activo. Renueva el 30 de octubre.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onClose).toHaveBeenCalled();
    await noViolations(baseElement as HTMLElement);
  });

  it('sin fecha de renovación conocida, usa el mensaje sin fecha', () => {
    render(<PlanCelebration open onClose={vi.fn()} t={t} planLabel="Mensual" renewalDate="" />);
    expect(screen.getByText('Tu plan Mensual ya está activo.')).toBeTruthy();
  });
});
