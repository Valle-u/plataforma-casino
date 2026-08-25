/**
 * Tipos compartidos del CRM/livechat en el front (jugador + operador).
 * Espejan el shape que emite el ChatGateway. Ver apps/api/src/chat.
 */

export type ChatDirection = 'inbound' | 'outbound' | 'system';

/** Adjunto de un mensaje (imagen o PDF). La `url` viene hidratada del backend. */
export interface ChatAttachment {
  storageKey: string;
  mime: string;
  sizeBytes: number;
  name: string;
  kind: 'image' | 'pdf';
  url?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  direction: ChatDirection;
  senderUserId: string | null;
  body: string | null;
  attachments: ChatAttachment[];
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
    username: string | null;
    userDisplayName: string | null;
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

// ── CRM del contacto (contexto + notas + tags) ─────────────────────────────

export interface CrmMovement {
  id: string;
  amountChips: string;
  amountFiat: string;
  status: string;
  createdAt: string | null;
}

export interface ContactContext {
  contact: {
    id: string;
    userId: string | null;
    displayName: string | null;
    phone: string | null;
    email: string | null;
    isLead: boolean;
  };
  identity: {
    username: string;
    displayName: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    createdAt: string | null;
  } | null;
  wallet: {
    balance: string;
    bonusBalance: string;
    lockedBalance: string;
    currency: string;
  } | null;
  upline: { operatorId: string; username: string } | null;
  recentDeposits: CrmMovement[];
  recentWithdrawals: CrmMovement[];
}

export interface CrmNote {
  id: string;
  contactId: string;
  authorUserId: string | null;
  body: string;
  createdAt: string;
}

export interface CrmTag {
  id: string;
  label: string;
  color: string | null;
  createdAt: string;
}

/** Plantilla de respuesta rápida (por tenant) que el operador inserta. */
export interface CrmTemplate {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  createdAt: string;
}
