import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number) => trimmed(max).min(1, 'required');
const uuidString = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'not_found');

/** Chat interno 1 a 1 entre el dueño y sus empleados del mismo negocio (nunca con un cliente, que no inicia sesión). */

export const startConversationInputSchema = z.object({ userId: uuidString });
export type StartConversationInput = z.input<typeof startConversationInputSchema>;

export const sendMessageInputSchema = z.object({ content: required(4000) });
export type SendMessageInput = z.input<typeof sendMessageInputSchema>;

/** Alguien con quien se puede chatear (o con quien ya se chateó): igual que aparece en "Empleados"/"Equipo". */
export interface MessagePerson {
  id: string;
  name: string;
  photoUrl: string | null;
  isOwner: boolean;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  readAt: string | null;
}

export interface ConversationDto {
  id: string;
  peer: MessagePerson;
  lastMessage: { content: string; senderId: string; createdAt: string } | null;
  /** Mensajes del otro lado sin leer en esta conversación. */
  unreadCount: number;
  updatedAt: string;
}
