/**
 * Tipos compartidos del CRM/livechat en el front (jugador + operador).
 * Espejan el shape que emite el ChatGateway. Ver apps/api/src/chat.
 */

export type ChatDirection = 'inbound' | 'outbound' | 'system';

export interface ChatMessage {
  id: string;
  conversationId: string;
  direction: ChatDirection;
  senderUserId: string | null;
  body: string | null;
  attachments: unknown[];
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  contactId: string;
  channelId: string;
  assignedOperatorId: string | null;
  status: string;
  lastMessageAt: string | null;
  unreadForOperator: number;
  unreadForContact: number;
  createdAt: string;
  updatedAt: string;
}

/** Ítem de la bandeja del operador (conversación + contacto mínimo). */
export interface InboxItem {
  conversation: ChatConversation;
  contact: {
    id: string;
    displayName: string | null;
    userId: string | null;
    isLead: boolean;
    phone: string | null;
  };
}

/** Payload del evento `message:new`. */
export interface MessageNewEvent {
  conversationId: string;
  message: ChatMessage;
}

/** Payload del evento `typing`. */
export interface TypingEvent {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

/** Estado de la conexión del socket (para el chrome de la UI). */
export type ChatStatus = 'connecting' | 'connected' | 'disconnected';
