import type { Item, LoyaltyClientProgress, LoyaltyProgram, LoyaltyRedemption } from '@xiro/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoyaltyView, type LoyaltyViewProps } from '../src/web/screens/Loyalty';
import { tw } from '../src/web/shell/strings';

const t = (key: string, params?: Record<string, string | number>) => tw('es', key, params);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

const item: Item = {
  id: 'i1',
  name: 'Corte de cabello',
  categoryId: 'c1',
  categoryName: 'Cortes',
  shortDescription: '',
  description: '',
  detail: '',
  price: 25000,
  published: true,
  referenceCode: 'REF-1',
  internalUnitCost: 0,
  stock: 0,
  stockStatus: 'available',
  internalNotes: '',
  photos: [],
  updatedAt: new Date().toISOString(),
};

const program: LoyaltyProgram = { enabled: true, goal: 5, resetOnRedeem: true, rewardMessage: '¡Felicidades!', itemIds: ['i1'] };

const clientProgress: LoyaltyClientProgress = { clientId: 'cl1', clientName: 'Marta Ríos', clientPhone: '573001234567', count: 3, goal: 5, rewardAvailable: false };

const redemption: LoyaltyRedemption = { id: 'r1', clientId: 'cl1', clientName: 'Marta Ríos', goalAtRedemption: 5, redeemedAt: new Date('2026-01-10').toISOString() };

function loyalty(overrides: Partial<LoyaltyViewProps> = {}) {
  const props: LoyaltyViewProps = {
    t,
    currency: 'COP',
    businessName: 'Studio Ana',
    program,
    items: [item],
    clientsProgress: [clientProgress],
    redemptions: [redemption],
    onSaveProgram: vi.fn(async () => ({ ok: true as const })),
    onRecordService: vi.fn(async () => ({ ok: true as const, rewardJustEarned: false })),
    onRedeem: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
  return { props, ...render(<LoyaltyView {...props} />) };
}

let openSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  openSpy = vi.fn();
  vi.stubGlobal('open', openSpy);
});

describe('LoyaltyView', () => {
  it('opens on the clients tab when the program is enabled, and passes axe', async () => {
    const { container } = loyalty();
    expect(screen.getByRole('tab', { name: 'Clientes', selected: true })).toBeTruthy();
    expect(screen.getByText('Marta Ríos')).toBeTruthy();
    expect(screen.getByText('3 / 5')).toBeTruthy();
    await noViolations(container);
  });

  it('opens on the config tab when the program is disabled', () => {
    loyalty({ program: { ...program, enabled: false } });
    expect(screen.getByRole('tab', { name: 'Configuración', selected: true })).toBeTruthy();
  });

  it('config tab: saves the goal, reset toggle, message and eligible items', async () => {
    const onSaveProgram = vi.fn(async () => ({ ok: true as const }));
    loyalty({ program: { ...program, enabled: false }, onSaveProgram });
    const u = userEvent.setup();

    const goalInput = screen.getByLabelText('Meta (servicios para ganar el premio)');
    await u.clear(goalInput);
    await u.type(goalInput, '10');
    await u.click(screen.getByRole('checkbox', { name: 'Activar programa de fidelización' }));
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSaveProgram).toHaveBeenCalledWith({ enabled: true, goal: 10, resetOnRedeem: true, rewardMessage: '¡Felicidades!', itemIds: ['i1'] }));
    expect(await screen.findByText('Guardado')).toBeTruthy();
  });

  it('config tab: rejects a goal of zero without calling onSaveProgram', async () => {
    const onSaveProgram = vi.fn(async () => ({ ok: true as const }));
    loyalty({ program: { ...program, enabled: false }, onSaveProgram });
    const u = userEvent.setup();

    const goalInput = screen.getByLabelText('Meta (servicios para ganar el premio)');
    await u.clear(goalInput);
    await u.type(goalInput, '0');
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Ingresa un número entero mayor a 0.')).toBeTruthy();
    expect(onSaveProgram).not.toHaveBeenCalled();
  });

  it('clients tab: records a service for a client and shows the "just earned" banner when the reward is reached', async () => {
    const onRecordService = vi.fn(async () => ({ ok: true as const, rewardJustEarned: true }));
    loyalty({ onRecordService });
    const u = userEvent.setup();

    await u.click(screen.getByRole('button', { name: 'Registrar servicio' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Registrar servicio de Marta Ríos' })).toBeTruthy();
    await u.selectOptions(screen.getByLabelText(/Servicio realizado/), 'i1');
    await u.click(screen.getByRole('button', { name: 'Registrar servicio' }));

    await waitFor(() => expect(onRecordService).toHaveBeenCalledWith({ clientId: 'cl1', itemId: 'i1', amount: undefined, note: '' }));
    expect(await screen.findByText('¡Este cliente acaba de ganar su premio!')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Registrar servicio de Marta Ríos' })).toBeNull();
  });

  it('clients tab: shows the reward banner, a redeem button and a WhatsApp notify link only once the reward is available', async () => {
    const onRedeem = vi.fn(async () => ({ ok: true as const }));
    const available: LoyaltyClientProgress = { ...clientProgress, count: 5, rewardAvailable: true };
    loyalty({ clientsProgress: [available], onRedeem });

    expect(screen.getByText('Premio disponible para canjear.')).toBeTruthy();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Avisar por WhatsApp' }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/573001234567?text='), '_blank', 'noopener,noreferrer');

    await u.click(screen.getByRole('button', { name: 'Canjear premio' }));
    await waitFor(() => expect(onRedeem).toHaveBeenCalledWith('cl1'));
  });

  it('shows a hint instead of the client list when the program is disabled', async () => {
    loyalty({ program: { ...program, enabled: false } });
    const u = userEvent.setup();
    await u.click(screen.getByRole('tab', { name: 'Clientes' }));
    expect(screen.getByText('El programa de fidelización está apagado. Actívalo en la pestaña Configuración para empezar a sumar sellos.')).toBeTruthy();
  });

  it('history tab: lists redemptions with the goal reached and the date', async () => {
    loyalty();
    const u = userEvent.setup();
    await u.click(screen.getByRole('tab', { name: 'Historial' }));
    expect(screen.getByText('Marta Ríos canjeó su premio (5 servicios).')).toBeTruthy();
  });

  it('history tab: shows an empty message when nothing has been redeemed', async () => {
    loyalty({ redemptions: [] });
    const u = userEvent.setup();
    await u.click(screen.getByRole('tab', { name: 'Historial' }));
    expect(screen.getByText('Aún no se ha canjeado ningún premio.')).toBeTruthy();
  });

  it('a non-owner without redeem permission: no config tab, no history tab, no redeem/notify buttons; can still record services', () => {
    loyalty({ program: { ...program, enabled: false }, clientsProgress: [{ ...clientProgress, count: 5, rewardAvailable: true }], canConfigure: false, canRedeem: false });
    expect(screen.queryByRole('tab', { name: 'Configuración' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Historial' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Clientes', selected: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Canjear premio' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Avisar por WhatsApp' })).toBeNull();
  });

  it('an employee who can redeem but not configure keeps the history tab', () => {
    loyalty({ canConfigure: false, canRedeem: true });
    expect(screen.queryByRole('tab', { name: 'Configuración' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Historial' })).toBeTruthy();
  });
});
