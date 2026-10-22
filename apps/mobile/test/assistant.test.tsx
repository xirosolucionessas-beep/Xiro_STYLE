import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantPanel } from '../src/web/ui/AssistantPanel';
import { FloatingAssistant } from '../src/web/ui/FloatingAssistant';
import type { AssistantAskResult, AssistantRequest } from '../src/web/services/assistant.web';
import { tw } from '../src/web/shell/strings';

const t = (key: string) => tw('es', key);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

/* ---------- Mocks globales: jsdom no implementa blob:, cámara ni grabación ---------- */
let objectUrlCount = 0;
beforeEach(() => {
  objectUrlCount = 0;
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => `blob:mock-${objectUrlCount++}`);
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

class FakeTrack {
  stop = vi.fn();
}
class FakeStream {
  private tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}
class FakeRecorder {
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function mockMicrophone(behavior: 'granted' | 'denied' | 'unsupported') {
  if (behavior === 'unsupported') {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    return;
  }
  const getUserMedia = behavior === 'granted' ? vi.fn().mockResolvedValue(new FakeStream()) : vi.fn().mockRejectedValue(new Error('denied'));
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
}

// Con firma completa (aunque no usen la petición) para que `vi.fn(succeed)` infiera bien el tipo de `mock.calls`.
const succeed = async (request: AssistantRequest): Promise<AssistantAskResult> => {
  void request;
  return { ok: true, reply: 'Vendiste $ 500.000 esta semana.' };
};
const unavailable = async (request: AssistantRequest): Promise<AssistantAskResult> => {
  void request;
  return { ok: false, reason: 'unavailable' };
};

/* ---------- Botón flotante ---------- */

describe('FloatingAssistant', () => {
  it('is a labelled button that reports whether the panel is open', async () => {
    const onPress = vi.fn();
    const { rerender } = render(<FloatingAssistant label="Asistente de negocio" open={false} onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Asistente de negocio' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await userEvent.setup().click(button);
    expect(onPress).toHaveBeenCalledOnce();
    rerender(<FloatingAssistant label="Asistente de negocio" open onPress={onPress} />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });
});

/* ---------- Panel ---------- */

describe('AssistantPanel', () => {
  it('stays mounted but hidden while closed, and becomes a real dialog with the welcome message when open', async () => {
    mockMicrophone('granted');
    const onClose = vi.fn();
    const { rerender } = render(<AssistantPanel open={false} onClose={onClose} t={t} language="es" ask={unavailable} />);
    expect(document.querySelector('.xw-asst-root')?.className).toContain('is-closed');
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<AssistantPanel open onClose={onClose} t={t} language="es" ask={unavailable} />);
    const dialog = screen.getByRole('dialog', { name: 'Asistente de negocio' });
    // El saludo cambia según la hora del día (ver assistantGreeting); sin nombre de negocio, la parte fija es genérica.
    expect(within(dialog).getByText(/Soy su asistente de negocio\. ¿En qué puedo ayudarle\?/)).toBeTruthy();
    expect(within(dialog).getByText('Consultas privadas de tu negocio')).toBeTruthy();
    await noViolations(dialog);
  });

  it('greets by the business name when one is known, never a made-up one', async () => {
    mockMicrophone('granted');
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" businessName="Studio Bella" ask={unavailable} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Soy el asistente de Studio Bella\. ¿En qué puedo ayudarle\?/)).toBeTruthy();
  });

  it('Escape closes it and returns focus to whatever opened it', async () => {
    mockMicrophone('granted');
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>abrir</button>
          <AssistantPanel open={open} onClose={() => setOpen(false)} t={t} language="es" ask={unavailable} />
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    const opener = screen.getByRole('button', { name: 'abrir' });
    await user.click(opener);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('disables Send until there is text or an attachment, Enter sends and Shift+Enter only breaks the line', async () => {
    mockMicrophone('granted');
    const ask = vi.fn(succeed);
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" ask={ask} />);
    const user = userEvent.setup();
    const send = screen.getByRole('button', { name: 'Enviar' });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText('Consulta para el asistente');
    await user.type(input, 'Hola{Shift>}{Enter}{/Shift}Ventas de hoy');
    expect((input as HTMLTextAreaElement).value).toBe('Hola\nVentas de hoy');
    expect(ask).not.toHaveBeenCalled();
    expect((send as HTMLButtonElement).disabled).toBe(false);

    await user.type(input, '{Enter}');
    expect(ask).toHaveBeenCalledWith({ text: 'Hola\nVentas de hoy', attachments: [], language: 'es' });
    expect(await screen.findByText('Vendiste $ 500.000 esta semana.', { selector: '.xw-asst-msg p' })).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('with the real service, a question outside the closed catalog is answered honestly, never with a made-up reply', async () => {
    mockMicrophone('granted');
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Consulta para el asistente'), 'cuéntame un chiste');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('No entendí esa pregunta. Elige una de estas, o toca «Ver todas las preguntas»:', { selector: '.xw-asst-msg p' })).toBeTruthy();
  });

  it('a network error shows a banner with Retry, which resends the very same message', async () => {
    mockMicrophone('granted');
    const ask = vi
      .fn<(request: AssistantRequest) => Promise<AssistantAskResult>>()
      .mockResolvedValueOnce({ ok: false, reason: 'network' })
      .mockResolvedValueOnce(await succeed({ text: '', attachments: [], language: 'es' }));
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" ask={ask} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Consulta para el asistente'), 'Reintento por favor');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('No pudimos enviar tu consulta.');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Vendiste $ 500.000 esta semana.', { selector: '.xw-asst-msg p' })).toBeTruthy();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][0]).toEqual({ text: 'Reintento por favor', attachments: [], language: 'es' });
  });

  it('attaches an image via the file picker, previews it and can remove it before sending', async () => {
    mockMicrophone('granted');
    const ask = vi.fn(succeed);
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" ask={ask} />);
    const user = userEvent.setup();
    const file = new File(['x'], 'inventario.png', { type: 'image/png' });
    const input = document.querySelector('input[type=file]:not([capture])') as HTMLInputElement;
    await user.upload(input, file);

    await screen.findByRole('button', { name: /Quitar adjunto: inventario\.png/ });
    expect(screen.getByRole('button', { name: 'Enviar' }).hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(ask).toHaveBeenCalledWith({ text: '', attachments: [{ kind: 'image', name: 'inventario.png', blob: file }], language: 'es' });
    expect(screen.queryByRole('button', { name: /Quitar adjunto: inventario\.png/ })).toBeNull();
  });

  it('rejects a file of the wrong type without touching the network-error state', async () => {
    mockMicrophone('granted');
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" />);
    const input = document.querySelector('input[type=file]:not([capture])') as HTMLInputElement;
    const file = new File(['x'], 'nota.pdf', { type: 'application/pdf' });
    // El picker nativo ya filtra por `accept`; se desactiva ese filtro para probar la validación propia del panel.
    await userEvent.setup({ applyAccept: false }).upload(input, file);
    expect(await screen.findByText('Elige una imagen JPG, PNG o WebP.')).toBeTruthy();
    // Es un error de validación de archivo, no el banner de red-con-reintento (sin botón "Reintentar").
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    expect(document.querySelector('.xw-asst-error')).toBeNull();
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('records a voice note: asks for the mic, shows the pulsing timer, and "Detener y adjuntar" leaves it ready to preview and send', async () => {
    mockMicrophone('granted');
    const ask = vi.fn(succeed);
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" ask={ask} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Grabar audio' }));
    expect(await screen.findByText('Grabando nota de voz')).toBeTruthy();
    expect(screen.queryByLabelText('Consulta para el asistente')).toBeNull(); // el campo de texto se reemplaza por la barra de grabación
    await user.click(screen.getByRole('button', { name: 'Detener y adjuntar' }));
    await waitFor(() => expect(screen.getByLabelText('Consulta para el asistente')).toBeTruthy());
    expect(document.querySelector('.xw-asst-attachment audio')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(ask.mock.calls[0]![0].attachments).toEqual([{ kind: 'audio', name: 'Nota de voz', blob: expect.any(Blob) }]);
  });

  it('"Cancelar" while recording discards the audio (no attachment is added)', async () => {
    mockMicrophone('granted');
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Grabar audio' }));
    await screen.findByText('Grabando nota de voz');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.getByLabelText('Consulta para el asistente')).toBeTruthy());
    expect(document.querySelector('.xw-asst-attachment')).toBeNull();
  });

  it('a denied microphone shows the friendly permissions message', async () => {
    mockMicrophone('denied');
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Grabar audio' }));
    expect(await screen.findByText('No pudimos acceder al micrófono. Revisa los permisos del navegador.')).toBeTruthy();
  });

  it('keeps the draft text and attachments when the panel is closed and reopened (in-memory only, still mounted)', async () => {
    mockMicrophone('granted');
    const { rerender } = render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" ask={unavailable} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Consulta para el asistente'), 'Borrador sin enviar');
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    await user.upload(document.querySelector('input[type=file]:not([capture])') as HTMLInputElement, file);

    rerender(<AssistantPanel open={false} onClose={vi.fn()} t={t} language="es" ask={unavailable} />);
    rerender(<AssistantPanel open onClose={vi.fn()} t={t} language="es" ask={unavailable} />);
    expect((screen.getByLabelText('Consulta para el asistente') as HTMLTextAreaElement).value).toBe('Borrador sin enviar');
    expect(screen.getByRole('button', { name: /Quitar adjunto: foto\.jpg/ })).toBeTruthy();
  });

  it('never logs the conversation to the console', async () => {
    mockMicrophone('granted');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const ask = vi.fn(succeed);
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" ask={ask} />);
    await userEvent.setup().type(screen.getByLabelText('Consulta para el asistente'), 'dato privado del negocio{Enter}');
    await screen.findByText('Vendiste $ 500.000 esta semana.', { selector: '.xw-asst-msg p' });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('a voice note gets a polite "please type it" reply — never a made-up transcription (no STT yet)', async () => {
    mockMicrophone('granted');
    // Con el servicio real (sin `ask` inyectado): nunca llega a la red con una nota de voz adjunta.
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Grabar audio' }));
    await screen.findByText('Grabando nota de voz');
    await user.click(screen.getByRole('button', { name: 'Detener y adjuntar' }));
    await waitFor(() => expect(screen.getByLabelText('Consulta para el asistente')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Por ahora no puedo escuchar notas de voz. ¿Podría escribir su consulta, por favor?', { selector: '.xw-asst-msg p' })).toBeTruthy();
  });

  it('expand/minimize are accessible toggle buttons (keyboard-operable), separate from fully closing the panel', async () => {
    mockMicrophone('granted');
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" ask={unavailable} />);
    const user = userEvent.setup();
    const panelEl = () => document.querySelector('.xw-asst-panel') as HTMLElement;

    const expandBtn = screen.getByRole('button', { name: 'Expandir ventana' });
    expect(expandBtn.getAttribute('aria-pressed')).toBe('false');
    await user.click(expandBtn);
    expect(panelEl().className).toContain('is-expanded');
    expect(screen.getByRole('button', { name: 'Volver al tamaño normal' }).getAttribute('aria-pressed')).toBe('true');
    await user.keyboard('{Enter}'); // sigue enfocado tras el clic: Enter también lo colapsa (control de teclado)
    expect(panelEl().className).not.toContain('is-expanded');

    const minimizeBtn = screen.getByRole('button', { name: 'Minimizar' });
    await user.click(minimizeBtn);
    expect(panelEl().className).toContain('is-minimized');
    expect(screen.queryByLabelText('Consulta para el asistente')).toBeNull(); // el cuerpo se oculta; la cabecera sigue
    expect(screen.getByRole('dialog')).toBeTruthy(); // minimizar no es cerrar: sigue siendo el mismo diálogo montado
    await user.click(screen.getByRole('button', { name: 'Restaurar ventana' }));
    expect(panelEl().className).not.toContain('is-minimized');
    expect(screen.getByLabelText('Consulta para el asistente')).toBeTruthy();
  });
});

/* ---------- "Ver todas las preguntas" (catálogo, Fase B) ---------- */

describe('AssistantPanel — catálogo de preguntas', () => {
  it('abre el catálogo por categorías y, al elegir una pregunta sin período, la responde con datos reales', async () => {
    mockMicrophone('granted');
    const fetchCatalog = vi.fn().mockResolvedValue([{ question: 'employees_active', category: 'team', needsPeriod: false }]);
    const askQuestion = vi.fn().mockResolvedValue({
      ok: true,
      answer: { question: 'employees_active', category: 'team', period: null, currency: 'COP', source: 'Equipo', data: { question: 'employees_active', active: 3, limit: 5 } },
    });
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" fetchCatalog={fetchCatalog} askQuestion={askQuestion} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ver todas las preguntas' }));
    expect(await screen.findByText('Equipo')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '¿Cuántos empleados activos tengo?' }));
    expect(await screen.findByText(/3 \/ 5/, { selector: '.xw-asst-msg p' })).toBeTruthy();
    expect(askQuestion).toHaveBeenCalledWith('employees_active', undefined);
  });

  it('una pregunta con período pide elegirlo antes de ejecutarla', async () => {
    mockMicrophone('granted');
    const fetchCatalog = vi.fn().mockResolvedValue([{ question: 'sales_total', category: 'sales', needsPeriod: true }]);
    const askQuestion = vi.fn().mockResolvedValue({
      ok: true,
      answer: {
        question: 'sales_total',
        category: 'sales',
        period: { period: 'today', from: '2026-01-01', to: '2026-01-01' },
        currency: 'COP',
        source: 'Reportes → Ventas',
        data: { question: 'sales_total', total: 80_000, count: 2 },
      },
    });
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" fetchCatalog={fetchCatalog} askQuestion={askQuestion} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ver todas las preguntas' }));
    await user.click(await screen.findByRole('button', { name: '¿Cuánto vendí en el período?' }));
    await user.click(await screen.findByRole('button', { name: 'Hoy' }));
    expect(await screen.findByText((_, el) => /80[.,]000/.test(el?.textContent ?? ''), { selector: '.xw-asst-msg p' })).toBeTruthy();
    expect(askQuestion).toHaveBeenCalledWith('sales_total', 'today');
  });

  it('sin permiso para la pregunta (403), muestra el aviso de acceso en vez de un error genérico', async () => {
    mockMicrophone('granted');
    const fetchCatalog = vi.fn().mockResolvedValue([{ question: 'net_profit', category: 'finance', needsPeriod: true }]);
    const askQuestion = vi.fn().mockResolvedValue({ ok: false, reason: 'no_access' });
    render(<AssistantPanel open onClose={vi.fn()} t={t} language="es" fetchCatalog={fetchCatalog} askQuestion={askQuestion} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ver todas las preguntas' }));
    await user.click(await screen.findByRole('button', { name: '¿Cuál fue la utilidad neta?' }));
    await user.click(await screen.findByRole('button', { name: 'Hoy' }));
    expect(await screen.findByText('No tienes permiso para esta pregunta.', { selector: '.xw-asst-msg p' })).toBeTruthy();
  });
});
