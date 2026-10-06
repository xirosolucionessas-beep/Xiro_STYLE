import { formatMoney } from '@xiro/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import type { CartLine, PaymentRow } from '../src/lib/sale';
import { SaleFormView, type SaleFormViewProps } from '../src/web/screens/SaleForm';
import { tw } from '../src/web/shell/strings';

const t = (key: string, params?: Record<string, string | number>) => tw('es', key, params);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

const line = (over: Partial<CartLine> = {}): CartLine => ({ key: 'l1', kind: 'service', itemId: 'i1', name: 'Corte', unitPrice: 30_000, catalogPrice: 30_000, quantity: 1, employeeId: 'me', saveToCatalog: false, stock: null, ...over });
const payment = (over: Partial<PaymentRow> = {}): PaymentRow => ({ key: 'p1', method: 'cash', amount: 30_000, receivedAmount: null, ...over });

function baseProps(over: Partial<SaleFormViewProps> = {}): SaleFormViewProps {
  return {
    t,
    currency: 'COP',
    clientQuery: '',
    onClientQuery: vi.fn(),
    clientResults: [],
    clientSearchLoading: false,
    selectedClient: { id: 'c1', name: 'Ana Pérez' },
    occasional: false,
    onSelectClient: vi.fn(),
    onOccasional: vi.fn(),
    onChangeClient: vi.fn(),
    newClientOpen: false,
    onToggleNewClient: vi.fn(),
    newClientName: '',
    onNewClientName: vi.fn(),
    newClientPhone: '',
    onNewClientPhone: vi.fn(),
    onSaveNewClient: vi.fn(),
    newClientBusy: false,
    appointmentHint: null,
    appointmentLoaded: false,
    onLoadAppointment: vi.fn(),
    tab: 'service',
    onTab: vi.fn(),
    categories: [{ id: 'cat1', name: 'General' }],
    categoryFilter: null,
    onCategoryFilter: vi.fn(),
    itemQuery: '',
    onItemQuery: vi.fn(),
    catalogRows: [{ id: 'i1', name: 'Corte', price: 30_000, stock: null, categoryId: 'cat1' }],
    onAddCatalogItem: vi.fn(),
    manualOpen: false,
    onToggleManual: vi.fn(),
    manualKind: 'service',
    onManualKind: vi.fn(),
    manualName: '',
    onManualName: vi.fn(),
    manualPrice: 0,
    onManualPrice: vi.fn(),
    manualSaveToCatalog: false,
    onManualSaveToCatalog: vi.fn(),
    onAddManual: vi.fn(),
    lines: [line()],
    canOverridePrice: false,
    employees: [{ id: 'me', name: 'Tú' }],
    onLineQuantity: vi.fn(),
    onLinePrice: vi.fn(),
    onLineEmployee: vi.fn(),
    onRemoveLine: vi.fn(),
    discount: 0,
    onDiscount: vi.fn(),
    tip: 0,
    onTip: vi.fn(),
    payments: [payment()],
    onPaymentMethod: vi.fn(),
    onPaymentAmount: vi.fn(),
    onPaymentReceived: vi.fn(),
    onAddPayment: vi.fn(),
    onRemovePayment: vi.fn(),
    subtotal: 30_000,
    total: 30_000,
    changeDue: 0,
    remaining: 0,
    busy: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    result: null,
    onWhatsapp: vi.fn(),
    onDownloadPdf: vi.fn(),
    onPosTicket: vi.fn(),
    onPrint: vi.fn(),
    onNewSale: vi.fn(),
    ...over,
  };
}

describe('SaleFormView (Registrar venta)', () => {
  it('muestra al cliente elegido, la línea del carrito y el total a pagar, sin violaciones de accesibilidad', async () => {
    const props = baseProps();
    const { container } = render(<SaleFormView {...props} />);
    expect(screen.getByText('Ana Pérez')).toBeTruthy();
    expect(screen.getAllByText('Corte').length).toBeGreaterThan(0); // aparece en el catálogo y en el carrito
    expect(screen.getByRole('button', { name: /Registrar venta · \$\s?30\.000/ })).toBeTruthy();
    await noViolations(container);
  });

  it('agregar un artículo del catálogo llama a onAddCatalogItem con la fila completa', async () => {
    const props = baseProps({ lines: [] });
    render(<SaleFormView {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(props.onAddCatalogItem).toHaveBeenCalledWith(props.catalogRows[0]);
  });

  it('un producto agotado no se puede agregar', () => {
    const props = baseProps({ tab: 'product', catalogRows: [{ id: 'p1', name: 'Shampoo', price: 20_000, stock: 0, categoryId: 'cat1' }] });
    render(<SaleFormView {...props} />);
    expect((screen.getByRole('button', { name: 'Agregar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Agotado/)).toBeTruthy();
  });

  it('sin permiso de catálogo el precio de una línea de catálogo no es editable', () => {
    const props = baseProps({ canOverridePrice: false, lines: [line({ itemId: 'i1' })] });
    const { container } = render(<SaleFormView {...props} />);
    expect(screen.queryByLabelText('Ajustar precio de esta venta')).toBeNull();
    expect(container.querySelector('.xw-sale-cart-price')?.textContent).toBe(formatMoney(30_000, 'COP'));
  });

  it('con permiso de catálogo sí se puede ajustar el precio de una línea de catálogo', () => {
    const props = baseProps({ canOverridePrice: true, lines: [line({ itemId: 'i1' })] });
    render(<SaleFormView {...props} />);
    expect(screen.getByLabelText('Ajustar precio de esta venta')).toBeTruthy();
  });

  it('una línea a mano (sin itemId) nunca deja editar el precio, tenga o no permiso de catálogo', () => {
    const props = baseProps({ canOverridePrice: true, lines: [line({ itemId: null, name: 'Peinado especial' })] });
    render(<SaleFormView {...props} />);
    expect(screen.queryByLabelText('Ajustar precio de esta venta')).toBeNull();
  });

  it('la forma de pago se elige con tarjetas de ícono/logo, con el estado seleccionado visible', async () => {
    const props = baseProps();
    render(<SaleFormView {...props} />);
    const cash = screen.getByRole('radio', { name: 'Efectivo' }) as HTMLInputElement;
    const nequi = screen.getByRole('radio', { name: 'Nequi' }) as HTMLInputElement;
    expect(cash.checked).toBe(true);
    expect(nequi.checked).toBe(false);
    await userEvent.click(nequi);
    expect(props.onPaymentMethod).toHaveBeenCalledWith('p1', 'nequi');
  });

  it('avisa cuando falta asignar pago y cuando se asignó de más, y no cuando el pago está completo', () => {
    const { rerender } = render(<SaleFormView {...baseProps({ remaining: 10_000 })} />);
    expect(screen.getByText(/Falta asignar/)).toBeTruthy();
    rerender(<SaleFormView {...baseProps({ remaining: -5_000 })} />);
    expect(screen.getByText(/de más/)).toBeTruthy();
    rerender(<SaleFormView {...baseProps({ remaining: 0 })} />);
    expect(screen.getByText('Pago completo')).toBeTruthy();
  });

  it('enviar la venta llama a onSubmit', async () => {
    const props = baseProps();
    render(<SaleFormView {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /Registrar venta/ }));
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it('un error de envío se muestra junto al botón', () => {
    render(<SaleFormView {...baseProps({ error: 'Los pagos deben sumar exactamente el total.' })} />);
    expect(screen.getByRole('alert').textContent).toContain('Los pagos deben sumar exactamente el total.');
  });

  it('tras registrar la venta se muestra la confirmación con el total, y "Registrar otra venta" reinicia', async () => {
    const props = baseProps({
      result: {
        id: 's1',
        clientId: 'c1',
        clientName: 'Ana Pérez',
        items: [{ id: 'si1', kind: 'service', itemId: 'i1', name: 'Corte', unitPrice: 30_000, quantity: 1, total: 30_000, employeeId: null, employeeName: null, loyaltyCounted: true }],
        payments: [{ id: 'sp1', method: 'cash', amount: 30_000, receivedAmount: 30_000 }],
        subtotal: 30_000,
        discount: 0,
        tip: 0,
        total: 30_000,
        changeGiven: 0,
        status: 'completed',
        voidReason: '',
        createdByName: 'Dueña',
        createdAt: new Date().toISOString(),
        rewardJustEarned: true,
      },
    });
    const { container } = render(<SaleFormView {...props} />);
    expect(screen.getByText('¡Venta registrada!')).toBeTruthy();
    expect(screen.getByText(/completó su sello/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Enviar recibo por WhatsApp/ }));
    expect(props.onWhatsapp).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Descargar factura en PDF/ }));
    expect(props.onDownloadPdf).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Comprobantes POS/ }));
    expect(props.onPosTicket).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar otra venta' }));
    expect(props.onNewSale).toHaveBeenCalled();
    await noViolations(container);
  });
});
