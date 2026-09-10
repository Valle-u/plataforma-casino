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
  /**
   * Por qué la respuesta **no llegó** al canal externo (**2.7**).
   *
   * Sólo aparece en los canales externos: en el widget web no hay proveedor
   * que pueda rechazar nada. Si viene, el mensaje se muestra marcado — sin
   * eso, el operador ve su mensaje en el hilo igual que cualquier otro y da
   * por hecho que llegó, cuando le está escribiendo a nadie.
   */
  deliveryError?: string | null;
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
  /**
   * Por qué canal llegó: `web`, `telegram`, y más adelante `whatsapp`.
   *
   * Opcional porque una bandeja abierta antes de este cambio puede tener en
   * memoria items sin el campo. Sin él, la fila se muestra sin la etiqueta de
   * canal en vez de romperse.
   */
  channelType?: string;
  /**
   * El cuerpo del último mensaje, para el preview.
   *
   * `null` = la conversación no tiene ninguno. **String vacío** = el último fue
   * sólo un adjunto: el cuerpo se guarda vacío y el archivo va aparte. Los dos
   * casos se muestran distinto.
   */
  lastMessageBody?: string | null;
  /** Etiquetas del contacto. Vienen con la lista, no se piden por fila. */
  tags?: Array<{ id: string; label: string; color: string | null }>;
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
  /**
   * De qué red es el jugador, respecto de quien está mirando.
   *
   * `same: false` significa que el backend **no mandó la plata**: `wallet`,
   * `recentDeposits`, `recentWithdrawals` y `upline` vienen vacíos por la LEY
   * R6, no porque el jugador no tenga movimientos. La pantalla usa `label` para
   * el cartel de red (D3).
   *
   * ⚠️ **No es un permiso de la interfaz.** El dato no llega: esconder o
   * mostrar acá no cambia nada del otro lado.
   *
   * `null` en un lead que todavía no está vinculado a ningún jugador.
   */
  network: { same: boolean; label: string | null } | null;
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
