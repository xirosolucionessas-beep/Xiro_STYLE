import type { AvailabilitySlot } from '@xiro/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SlotGrid } from '../src/ui/SlotGrid';

const slots: AvailabilitySlot[] = [
  { time: '09:00', startsAt: '2026-10-06T14:00:00.000Z', state: 'available' },
  { time: '09:30', startsAt: '2026-10-06T14:30:00.000Z', state: 'booked' },
  { time: '10:00', startsAt: '2026-10-06T15:00:00.000Z', state: 'unavailable' },
];

describe('SlotGrid', () => {
  it('un horario libre se puede elegir; uno ocupado o no disponible está deshabilitado y lo dice', () => {
    render(<SlotGrid slots={slots} value={null} onChange={vi.fn()} language="es" />);
    const free = screen.getByRole('radio', { name: /^9:00/ }) as HTMLButtonElement;
    expect(free.disabled).toBe(false);
    const booked = screen.getByRole('radio', { name: /9:30.*ocupado/i }) as HTMLButtonElement;
    expect(booked.disabled).toBe(true);
    const unavailable = screen.getByRole('radio', { name: /10:00.*no disponible/i }) as HTMLButtonElement;
    expect(unavailable.disabled).toBe(true);
  });

  it('marca como elegido el horario que coincide con `value`', () => {
    render(<SlotGrid slots={slots} value="2026-10-06T14:00:00.000Z" onChange={vi.fn()} language="es" />);
    expect(screen.getByRole('radio', { name: /^9:00/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('elegir un horario libre llama a onChange con el horario completo', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SlotGrid slots={slots} value={null} onChange={onChange} language="es" />);
    await user.click(screen.getByRole('radio', { name: /^9:00/ }));
    expect(onChange).toHaveBeenCalledWith(slots[0]);
  });
});
