import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import type { Subscription } from '@xiro/shared';
import { describe, expect, it, vi } from 'vitest';
import { tw } from '../src/web/shell/strings';
import { SubscriptionStatusView, type SubscriptionStatusViewProps } from '../src/web/ui/SubscriptionStatusView';

const NOW = new Date('2026-10-18T15:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const base: Subscription = { plan: null, status: 'none', platform: null, paymentMethod: null, trialEndsAt: null, currentPeriodEnd: null, nextBillingAt: null, cancelAtPeriodEnd: false, gracePeriodEndsAt: null, hasAccess: false };

function view(overrides: Partial<SubscriptionStatusViewProps> = {}) {
  const props: SubscriptionStatusViewProps = {
    t: (key, params) => tw('es', key, params),
    language: 'es',
    timezone: 'America/Bogota',
    isOwner: true,
    state: { kind: 'loading' },
    onRetry: vi.fn(),
    onManage: vi.fn(),
    now: NOW,
    ...overrides,
  };
  return { props, ...render(<SubscriptionStatusView {...props} />) };
}

describe('perfil web: tarjeta "Suscripción y estado de cuenta"', () => {
  it('cargando y error: no bloquea, explica y permite reintentar', async () => {
    view();
    expect(screen.getByText('Consultando tu suscripción…')).toBeTruthy();
    const { props } = view({ state: { kind: 'error', retrying: false } });
    expect(screen.getByRole('alert').textContent).toContain('No pudimos consultar tu suscripción');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('cortesía vigente: estado, fecha en la zona del negocio y días restantes', async () => {
    const { container } = view({ state: { kind: 'ready', subscription: { ...base, status: 'expired', hasAccess: true, accessGrantEndsAt: '2026-11-17T15:00:00.000Z' } } });
    expect(screen.getByText('Acceso de cortesía vigente')).toBeTruthy();
    expect(screen.getByText('Cortesía vigente hasta')).toBeTruthy();
    expect(screen.getByText('17 de noviembre de 2026')).toBeTruthy();
    expect(screen.getByText('Quedan 30 días')).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('fecha cerca de medianoche: se muestra el día del NEGOCIO, no el del navegador', () => {
    // 2026-11-18 03:00 UTC = 17 nov 22:00 en Bogotá.
    view({ state: { kind: 'ready', subscription: { ...base, status: 'trial', hasAccess: true, trialEndsAt: '2026-11-18T03:00:00.000Z' } } });
    expect(screen.getByText('17 de noviembre de 2026')).toBeTruthy();
  });

  it('pago activo que se renueva: no lo presenta como vencimiento; prueba con cortesía programada la informa', () => {
    view({ state: { kind: 'ready', subscription: { ...base, status: 'active', hasAccess: true, currentPeriodEnd: inDays(10) } } });
    expect(screen.getByText('Fin del periodo pagado (se renueva)')).toBeTruthy();
    view({ state: { kind: 'ready', subscription: { ...base, status: 'trial', hasAccess: true, trialEndsAt: inDays(2), accessGrantUpcoming: { startsAt: inDays(2), endsAt: inDays(32) } } } });
    expect(screen.getByText(/Cortesía programada: del .* al .*\./)).toBeTruthy();
  });

  it('sin plan y vencido: sin días restantes inventados; empleado: estado sin detalles ni botón de pagos', () => {
    view({ state: { kind: 'ready', subscription: base } });
    expect(screen.getByText('Sin plan')).toBeTruthy();
    expect(screen.queryByText(/Quedan|Queda 1 día/)).toBeNull();
    view({ isOwner: false, state: { kind: 'ready', subscription: { ...base, status: 'trial', hasAccess: true } } });
    expect(screen.getByText('Fecha no disponible')).toBeTruthy();
    expect(screen.getByText('Las fechas y los detalles del plan solo los ve el dueño del negocio.')).toBeTruthy();
  });

  it('en inglés', () => {
    view({ t: (key, params) => tw('en', key, params), language: 'en', state: { kind: 'ready', subscription: { ...base, status: 'past_due', hasAccess: true, gracePeriodEndsAt: inDays(1) } } });
    expect(screen.getByText('Payment overdue · grace period')).toBeTruthy();
    expect(screen.getByText('1 day left')).toBeTruthy();
  });
});
