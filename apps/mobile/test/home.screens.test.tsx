import { formatMoney } from '@xiro/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { XIRO_CONTACT } from '../src/web/config/contact.web';
import { ServiceDetailView, type ServiceDetailViewProps } from '../src/web/screens/ServiceDetail';
import { tw } from '../src/web/shell/strings';
import { CashOpeningModal, type CashOpeningModalProps } from '../src/web/ui/CashOpeningModal';
import { FloatingWhatsApp } from '../src/web/ui/FloatingWhatsApp';
import { GalleryViewer } from '../src/web/ui/GalleryViewer';

const t = (key: string) => tw('es', key);
// formatMoney usa el espacio de no separación (NBSP) de Intl; el DOM lo normaliza a espacio normal al comparar texto.
const NBSP = String.fromCharCode(160);
const money = (amount: number) => formatMoney(amount, 'COP').split(NBSP).join(' ');

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

/* ---------- Base inicial del día ---------- */

function cashModal(overrides: Partial<CashOpeningModalProps> = {}) {
  const props: CashOpeningModalProps = {
    open: true,
    onClose: vi.fn(),
    currentAmount: 0,
    currency: 'COP',
    t,
    onSubmit: vi.fn(async () => ({ ok: true })),
    onSkip: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CashOpeningModal {...props} />) };
}

describe('CashOpeningModal', () => {
  it('is a real dialog, shows the current base and passes axe', async () => {
    const { container } = cashModal({ currentAmount: 50000 });
    expect(screen.getByRole('dialog', { name: 'Base inicial del día' })).toBeTruthy();
    expect(screen.getByText(money(50000))).toBeTruthy();
    await noViolations(container);
  });

  it('formats the amount with thousands separators while typing and sends the real number', async () => {
    const { props } = cashModal();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Monto inicial'), '100000');
    expect((screen.getByLabelText('Monto inicial') as HTMLInputElement).value).toBe('100.000');
    await user.type(screen.getByLabelText('Nota opcional'), 'Caja chica');
    await user.click(screen.getByRole('button', { name: 'Comenzar el día' }));
    expect(props.onSubmit).toHaveBeenCalledWith({ amount: 100000, note: 'Caja chica' });
  });

  it('shows the API error without closing, and "Omitir por hoy" closes without submitting', async () => {
    const { props } = cashModal({ onSubmit: vi.fn(async () => ({ ok: false, general: 'No se pudo guardar.' })) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Comenzar el día' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No se pudo guardar.');
    await user.click(screen.getByRole('button', { name: 'Omitir por hoy' }));
    expect(props.onSkip).toHaveBeenCalledOnce();
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    cashModal({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/* ---------- Botón flotante de WhatsApp ---------- */

describe('FloatingWhatsApp', () => {
  it('links to the official Xiro WhatsApp (not the client one) with the business in the message, opening in a new tab', () => {
    render(<FloatingWhatsApp language="es" businessName="Studio Ana" label="Escríbenos por WhatsApp" />);
    const link = screen.getByRole('link', { name: 'Escríbenos por WhatsApp' });
    expect(link.getAttribute('href')).toContain(`https://wa.me/${XIRO_CONTACT.whatsappDigits}?text=`);
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('Studio Ana');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

/* ---------- Galería (ficha de servicio) ---------- */

const photos = ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg', 'https://cdn.example/c.jpg'];

describe('GalleryViewer', () => {
  it('shows an accessible empty state with no photos', async () => {
    const { container } = render(<GalleryViewer photos={[]} name="Corte" t={t} />);
    expect(screen.getByText('Sin fotos')).toBeTruthy();
    await noViolations(container);
  });

  it('shows the counter, dots and thumbnails, and passes axe with several photos', async () => {
    const { container } = render(<GalleryViewer photos={photos} name="Corte" t={t} />);
    expect(screen.getByText('1/3')).toBeTruthy();
    expect(screen.getAllByRole('img', { hidden: true }).length).toBeGreaterThanOrEqual(3); // slides + miniaturas
    expect(screen.getByRole('heading', { level: 2, name: 'Galería adicional' })).toBeTruthy();
    await noViolations(container);
  });

  it('a thumbnail click updates which dot is active (aria-current)', async () => {
    render(<GalleryViewer photos={photos} name="Corte" t={t} />);
    const thumbs = screen.getAllByRole('button', { name: /Corte — Foto \d de 3/ }).filter((b) => b.closest('.xw-thumbs'));
    await userEvent.setup().click(thumbs[2]!);
    const dots = screen.getAllByRole('button', { name: /Foto 3 de 3/ });
    expect(dots.some((d) => d.getAttribute('aria-current') === 'true')).toBe(true);
  });

  it('opens a full-screen dialog with a close button, keyboard navigation and click-to-zoom', async () => {
    render(<GalleryViewer photos={photos} name="Corte" t={t} />);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /Ver foto en pantalla completa/ })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Visor de fotos' });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText('1/3')).toBeTruthy();

    const zoomBtn = within(dialog).getByRole('button', { name: /Acercar/ });
    await user.click(zoomBtn);
    expect(within(dialog).getByRole('button', { name: /Alejar/ })).toBeTruthy();

    await user.keyboard('{ArrowRight}');
    expect(within(dialog).getByText('2/3')).toBeTruthy();
    // Al cambiar de foto el zoom se reinicia (vuelve a ofrecerse "Acercar").
    expect(within(dialog).getByRole('button', { name: /Acercar/ })).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/* ---------- Ficha de servicio ---------- */

function serviceDetail(overrides: Partial<ServiceDetailViewProps> = {}) {
  const props: ServiceDetailViewProps = {
    t,
    item: { id: '1', name: 'Corte Ejecutivo', categoryName: 'Cortes', description: 'Corte clásico con máquina y tijera.', shortDescription: '', detail: '', price: 35000, published: true, photos },
    currency: 'COP',
    publicUrl: 'https://xiro.example/catalog/studio-ana/item/1',
    onEdit: vi.fn(),
    onShare: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ServiceDetailView {...props} />) };
}

describe('ServiceDetailView', () => {
  it('shows description and price (name and category go in the page header), and passes axe', async () => {
    const { container } = serviceDetail();
    expect(screen.getByText('Corte clásico con máquina y tijera.')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText(money(35000))).toBeTruthy();
    await noViolations(container);
  });

  it('edit and WhatsApp-to-client actions fire, and the public link only shows when published', async () => {
    const { props } = serviceDetail();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Editar artículo' }));
    await user.click(screen.getByRole('button', { name: 'Enviar por WhatsApp' }));
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(props.onShare).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: /Ver página pública/ }).getAttribute('href')).toBe('https://xiro.example/catalog/studio-ana/item/1');
  });

  it('hides the public link and shows the hidden-from-catalog note when unpublished', () => {
    serviceDetail({ item: { id: '1', name: 'Corte', categoryName: 'Cortes', description: '', shortDescription: '', detail: '', price: 1000, published: false, photos: [] } });
    expect(screen.queryByRole('link', { name: /Ver página pública/ })).toBeNull();
    expect(screen.getByText('Oculto del catálogo')).toBeTruthy();
  });
});
