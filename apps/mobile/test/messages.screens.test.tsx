import type { ConversationDto, MessageDto, MessagePerson } from '@xiro/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { MessagesView, type MessagesViewProps } from '../src/web/screens/Messages';
import { tw } from '../src/web/shell/strings';

const t = (key: string, params?: Record<string, string | number>) => tw('es', key, params);

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
}

const ME = 'u-me';
const luis: MessagePerson = { id: 'u-luis', name: 'Luis Empleado', photoUrl: null, isOwner: false };
const ana: MessagePerson = { id: 'u-ana', name: 'Ana Dueña', photoUrl: 'https://cdn.test/ana.jpg', isOwner: true };

const conversationWithLuis: ConversationDto = { id: 'c-luis', peer: luis, lastMessage: { content: '¿Ya llegó el pedido?', senderId: luis.id, createdAt: '2026-01-01T10:00:00.000Z' }, unreadCount: 2, updatedAt: '2026-01-01T10:00:00.000Z' };
const conversationWithAna: ConversationDto = { id: 'c-ana', peer: ana, lastMessage: { content: 'Perfecto, gracias', senderId: ME, createdAt: '2026-01-01T09:00:00.000Z' }, unreadCount: 0, updatedAt: '2026-01-01T09:00:00.000Z' };

const thread: MessageDto[] = [
  { id: 'm1', conversationId: 'c-luis', senderId: luis.id, content: '¿Ya llegó el pedido?', createdAt: '2026-01-01T10:00:00.000Z', readAt: null },
  { id: 'm2', conversationId: 'c-luis', senderId: ME, content: 'Sí, ya está en bodega', createdAt: '2026-01-01T10:01:00.000Z', readAt: '2026-01-01T10:02:00.000Z' },
];

function view(overrides: Partial<MessagesViewProps> = {}) {
  const props: MessagesViewProps = {
    t,
    meId: ME,
    people: [luis, ana],
    peopleLoading: false,
    conversations: [conversationWithLuis, conversationWithAna],
    conversationsLoading: false,
    timeOf: () => 'hace 5 min',
    selectedId: null,
    onSelect: vi.fn(),
    onBack: vi.fn(),
    onStart: vi.fn(),
    thread: [],
    threadLoading: false,
    threadError: false,
    onSend: vi.fn(),
    sending: false,
    ...overrides,
  };
  return { props, ...render(<MessagesView {...props} />) };
}

describe('MessagesView', () => {
  it('lista las conversaciones con el último mensaje ("Tú: …" cuando lo escribió una misma) y el contador sin leer', () => {
    view();
    expect(screen.getByText('Luis Empleado')).toBeTruthy();
    expect(screen.getByText('¿Ya llegó el pedido?')).toBeTruthy();
    expect(screen.getByText('Tú: Perfecto, gracias')).toBeTruthy();
    expect(screen.getByLabelText('2 mensajes sin leer')).toBeTruthy();
  });

  it('sin conversaciones, un estado vacío (y no el de "elige una")', () => {
    view({ conversations: [] });
    expect(screen.getByText('Aún no tienes conversaciones')).toBeTruthy();
  });

  it('sin selección, el hilo pide elegir una conversación', () => {
    view();
    expect(screen.getByText('Elige una conversación de la lista, o empieza una nueva.')).toBeTruthy();
  });

  it('tocar una conversación la selecciona', async () => {
    const { props } = view();
    await userEvent.click(screen.getByRole('button', { name: /Luis Empleado/ }));
    expect(props.onSelect).toHaveBeenCalledWith('c-luis');
  });

  it('con una conversación elegida, muestra sus burbujas (mías a la derecha, suyas a la izquierda)', () => {
    view({ selectedId: 'c-luis', thread });
    const bubbles = document.querySelectorAll('.xw-bubble');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]!.className).toContain('is-theirs');
    expect(bubbles[1]!.className).toContain('is-mine');
    expect(screen.getByText('Sí, ya está en bodega')).toBeTruthy();
  });

  it('"Volver a la lista" llama a onBack', async () => {
    const { props } = view({ selectedId: 'c-luis', thread });
    await userEvent.click(screen.getByRole('button', { name: 'Volver a la lista' }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it('escribir y enviar: el botón se habilita solo con texto, limpia la caja y llama a onSend', async () => {
    const { props } = view({ selectedId: 'c-luis', thread });
    const sendBtn = screen.getByRole('button', { name: 'Enviar mensaje' });
    expect(sendBtn).toHaveProperty('disabled', true);
    const input = screen.getByLabelText('Escribe un mensaje…');
    await userEvent.type(input, 'Hola');
    expect(sendBtn).toHaveProperty('disabled', false);
    await userEvent.click(sendBtn);
    expect(props.onSend).toHaveBeenCalledWith('Hola');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('un error al enviar se muestra', () => {
    view({ selectedId: 'c-luis', thread, sendError: 'No se pudo enviar. Intenta de nuevo.' });
    expect(screen.getByRole('alert')).toHaveProperty('textContent', 'No se pudo enviar. Intenta de nuevo.');
  });

  it('"+" muestra a quién escribirle, sin repetir a quien ya tiene chat, y empieza uno nuevo', async () => {
    const { props } = view();
    await userEvent.click(screen.getByRole('button', { name: 'Nueva conversación' }));
    // Luis y Ana ya tienen conversación: no aparecen para "empezar" de nuevo.
    expect(screen.queryByRole('button', { name: /^Luis Empleado$/ })).toBeNull();
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('con alguien sin conversación todavía, aparece en el buscador y se puede empezar', async () => {
    const carla: MessagePerson = { id: 'u-carla', name: 'Carla Nueva', photoUrl: null, isOwner: false };
    const { props } = view({ people: [luis, ana, carla] });
    await userEvent.click(screen.getByRole('button', { name: 'Nueva conversación' }));
    await userEvent.click(screen.getByRole('button', { name: /Carla Nueva/ }));
    expect(props.onStart).toHaveBeenCalledWith('u-carla');
  });

  it('un negocio sin nadie más en el equipo lo dice, en vez de un buscador vacío', async () => {
    view({ people: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Nueva conversación' }));
    expect(screen.getByText(/Todavía no hay nadie más en tu equipo/)).toBeTruthy();
  });

  it('sin violaciones de accesibilidad, con y sin conversación elegida', async () => {
    const idle = view();
    await noViolations(idle.container);
    idle.unmount();
    const open = view({ selectedId: 'c-luis', thread });
    await noViolations(open.container);
  });
});
