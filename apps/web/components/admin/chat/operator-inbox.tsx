/**
 * OperatorInbox — bandeja de livechat del operador (panel).
 *
 * Dos paneles: lista de conversaciones asignadas (a ÉL, ruteo "solo el operador
 * directo") + el hilo activo con responder / typing / visto. Detrás del flag
 * CRM_ENABLED (la ruta /support solo aparece con el flag ON). Reusa el mismo
 * socket/tipos que el widget del jugador. Ver docs/22-crm-livechat.md.
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { MessageCircle, Paperclip, SendHorizontal } from 'lucide-react';
import { useChatSocket } from '@/lib/chat/use-chat-socket';
import type {
  ChatAttachment,
  ChatMessage,
  InboxItem,
  MessageNewEvent,
  TypingEvent,
} from '@/lib/chat/types';
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_MAX_COUNT,
  uploadChatAttachment,
} from '@/lib/chat/upload';
import { MessageAttachments } from '@/components/chat/message-attachments';
import { AttachmentChips } from '@/components/chat/attachment-chips';

interface ListAck {
  ok: boolean;
  conversations?: InboxItem[];
}
interface OpenAck {
  ok: boolean;
  messages?: ChatMessage[];
  error?: string;
}
interface ReplyAck {
  ok: boolean;
  message?: ChatMessage;
  error?: string;
}

function contactName(item: InboxItem): string {
  const c = item.contact;
  return (
    c.displayName ??
    c.phone ??
    (c.isLead ? 'Lead' : 'Jugador') + ' ' + c.id.slice(0, 6)
  );
}

export function OperatorInbox(): React.ReactElement {
  const { socket, status } = useChatSocket(true);
  const [conversations, setConversations] = useState<InboxItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [contactTyping, setContactTyping] = useState(false);
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const convRef = useRef<InboxItem[]>([]);
  convRef.current = conversations;
  const listEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingClear = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) =>
      prev.some((x) => x.id === m.id)
        ? prev
        : [...prev, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }, []);

  const loadInbox = useCallback(() => {
    if (!socket) return;
    socket.emit('conversation:list', {}, (ack: ListAck) => {
      if (ack?.ok) setConversations(ack.conversations ?? []);
    });
  }, [socket]);

  // Al (re)conectar: cargar la bandeja.
  useEffect(() => {
    if (socket && status === 'connected') loadInbox();
  }, [socket, status, loadInbox]);

  const selectConversation = useCallback(
    (id: string) => {
      if (!socket) return;
      setSelectedId(id);
      setContactTyping(false);
      setPending([]);
      setDraft('');
      socket.emit(
        'conversation:open',
        { conversationId: id },
        (ack: OpenAck) => {
          if (!ack?.ok) return;
          setMessages(
            (ack.messages ?? [])
              .slice()
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          );
        },
      );
      // Marcar leído localmente en la lista.
      setConversations((prev) =>
        prev.map((c) =>
          c.conversation.id === id
            ? {
                ...c,
                conversation: { ...c.conversation, unreadForOperator: 0 },
              }
            : c,
        ),
      );
    },
    [socket],
  );

  // Mensajes entrantes en vivo.
  useEffect(() => {
    if (!socket) return;
    const onNew = (evt: MessageNewEvent) => {
      const exists = convRef.current.some(
        (c) => c.conversation.id === evt.conversationId,
      );
      if (!exists) {
        loadInbox(); // conversación nueva → refrescar para traer el contacto
      } else {
        setConversations((prev) => {
          const item = prev.find(
            (c) => c.conversation.id === evt.conversationId,
          );
          if (!item) return prev;
          const isSel = selectedRef.current === evt.conversationId;
          const bump =
            !isSel && evt.message.direction === 'inbound'
              ? item.conversation.unreadForOperator + 1
              : item.conversation.unreadForOperator;
          const updated: InboxItem = {
            ...item,
            conversation: {
              ...item.conversation,
              lastMessageAt: evt.message.createdAt,
              unreadForOperator: bump,
            },
          };
          // Movemos la conversación actualizada al tope.
          const rest = prev.filter(
            (c) => c.conversation.id !== evt.conversationId,
          );
          return [updated, ...rest];
        });
      }
      if (selectedRef.current === evt.conversationId) addMessage(evt.message);
    };
    const onTyping = (evt: TypingEvent) => {
      if (evt.conversationId !== selectedRef.current) return;
      setContactTyping(evt.isTyping);
      if (typingClear.current) clearTimeout(typingClear.current);
      if (evt.isTyping) {
        typingClear.current = setTimeout(() => setContactTyping(false), 3000);
      }
    };
    socket.on('message:new', onNew);
    socket.on('typing', onTyping);
    return () => {
      socket.off('message:new', onNew);
      socket.off('typing', onTyping);
    };
  }, [socket, loadInbox, addMessage]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, contactTyping]);

  const emitTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket || !selectedId) return;
      socket.emit('typing', { conversationId: selectedId, isTyping });
    },
    [socket, selectedId],
  );

  const onDraftChange = useCallback(
    (v: string) => {
      setDraft(v);
      emitTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => emitTyping(false), 1500);
    },
    [emitTyping],
  );

  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      try {
        const slots = CHAT_ATTACHMENT_MAX_COUNT - pending.length;
        for (const f of Array.from(files).slice(0, Math.max(0, slots))) {
          try {
            const att = await uploadChatAttachment(f);
            setPending((p) => [...p, att]);
          } catch {
            // Un archivo que falla no corta los demás.
          }
        }
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [pending.length],
  );

  const removePending = useCallback(
    (key: string) => setPending((p) => p.filter((a) => a.storageKey !== key)),
    [],
  );

  const reply = useCallback(() => {
    const body = draft.trim();
    if (
      (!body && pending.length === 0) ||
      !socket ||
      !selectedId ||
      sending ||
      uploading
    ) {
      return;
    }
    setSending(true);
    socket.emit(
      'message:reply',
      { conversationId: selectedId, body, attachments: pending },
      (ack: ReplyAck) => {
        setSending(false);
        if (ack?.ok && ack.message) {
          addMessage(ack.message);
          setDraft('');
          setPending([]);
          emitTyping(false);
        }
      },
    );
  }, [draft, pending, socket, selectedId, sending, uploading, addMessage, emitTyping]);

  const selected = useMemo(
    () => conversations.find((c) => c.conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const statusLabel =
    status === 'connected'
      ? 'En línea'
      : status === 'connecting'
        ? 'Conectando…'
        : 'Sin conexión';

  return (
    <div style={wrapStyle}>
      {/* Lista */}
      <div
        style={{
          ...listPaneStyle,
          display: selectedId ? undefined : 'flex',
        }}
        data-mobile-hidden={selectedId ? 'true' : 'false'}
      >
        <div style={listHeaderStyle}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Conversaciones</span>
          <span style={{ fontSize: 11, color: 'var(--color-fg-subtle)' }}>
            {statusLabel}
          </span>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {conversations.length === 0 ? (
            <div style={listEmptyStyle}>Todavía no hay conversaciones.</div>
          ) : (
            conversations.map((item) => {
              const active = item.conversation.id === selectedId;
              const unread = item.conversation.unreadForOperator;
              return (
                <button
                  key={item.conversation.id}
                  onClick={() => selectConversation(item.conversation.id)}
                  style={{
                    ...convRowStyle,
                    background: active
                      ? 'var(--color-bg-hover)'
                      : 'transparent',
                  }}
                >
                  <div style={avatarStyle}>
                    {contactName(item).charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={convNameStyle}>{contactName(item)}</div>
                    <div style={convMetaStyle}>
                      {item.contact.isLead ? 'Lead' : 'Jugador'}
                    </div>
                  </div>
                  {unread > 0 && (
                    <span style={unreadPillStyle}>
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Hilo */}
      <div style={threadPaneStyle}>
        {!selected ? (
          <div style={threadEmptyStyle}>
            <MessageCircle size={32} style={{ opacity: 0.35, marginBottom: 10 }} />
            <p style={{ margin: 0, fontSize: 14 }}>
              Elegí una conversación para responder.
            </p>
          </div>
        ) : (
          <>
            <div style={threadHeaderStyle}>
              <button
                onClick={() => setSelectedId(null)}
                style={backBtnStyle}
                aria-label="Volver"
              >
                ‹
              </button>
              <div style={avatarStyle}>
                {contactName(selected).charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {contactName(selected)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-fg-subtle)' }}>
                  {contactTyping ? 'escribiendo…' : ''}
                </div>
              </div>
            </div>

            <div style={threadListStyle}>
              {messages.map((m) => (
                <MsgBubble key={m.id} message={m} />
              ))}
              {contactTyping && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={theirBubbleStyle}>…</div>
                </div>
              )}
              <div ref={listEndRef} />
            </div>

            <div style={composerStyle}>
              <AttachmentChips
                attachments={pending}
                uploading={uploading}
                onRemove={removePending}
              />
              <div style={inputRowStyle}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={CHAT_ATTACHMENT_ACCEPT}
                  multiple
                  onChange={(e) => {
                    void onPickFiles(e.target.files);
                  }}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    uploading || pending.length >= CHAT_ATTACHMENT_MAX_COUNT
                  }
                  aria-label="Adjuntar archivo"
                  style={attachBtnStyle}
                >
                  <Paperclip size={18} />
                </button>
                <textarea
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      reply();
                    }
                  }}
                  placeholder="Escribí tu respuesta…"
                  rows={1}
                  style={textareaStyle}
                />
                <button
                  onClick={reply}
                  disabled={
                    (!draft.trim() && pending.length === 0) ||
                    sending ||
                    uploading
                  }
                  aria-label="Enviar"
                  style={{
                    ...sendBtnStyle,
                    opacity:
                      (!draft.trim() && pending.length === 0) || sending
                        ? 0.5
                        : 1,
                  }}
                >
                  <SendHorizontal size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** inbound = jugador (izquierda); outbound = operador/nosotros (derecha). */
function MsgBubble({ message }: { message: ChatMessage }): React.ReactElement {
  const mine = message.direction === 'outbound';
  const system = message.direction === 'system';
  if (system) {
    return (
      <div style={{ textAlign: 'center', margin: '4px 0' }}>
        <span style={systemBubbleStyle}>{message.body}</span>
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: mine ? 'flex-end' : 'flex-start',
      }}
    >
      <div style={mine ? myBubbleStyle : theirBubbleStyle}>
        {message.body}
        <MessageAttachments attachments={message.attachments} />
      </div>
    </div>
  );
}

// ── Estilos ──────────────────────────────────────────────────────────────
const wrapStyle: CSSProperties = {
  display: 'flex',
  gap: 0,
  height: 'calc(100vh - 220px)',
  minHeight: 420,
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  overflow: 'hidden',
  background: 'var(--color-bg)',
};
const listPaneStyle: CSSProperties = {
  width: 300,
  flexShrink: 0,
  borderRight: '1px solid var(--color-border)',
  flexDirection: 'column',
  background: 'var(--color-bg-subtle)',
};
const listHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid var(--color-border)',
};
const listEmptyStyle: CSSProperties = {
  padding: 24,
  textAlign: 'center',
  fontSize: 13,
  color: 'var(--color-fg-muted)',
};
const convRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '10px 12px',
  border: 'none',
  borderBottom: '1px solid var(--color-border)',
  cursor: 'pointer',
  textAlign: 'left',
  color: 'var(--color-fg)',
};
const avatarStyle: CSSProperties = {
  width: 34,
  height: 34,
  flexShrink: 0,
  borderRadius: '50%',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg, #fff)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontSize: 14,
};
const convNameStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const convMetaStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--color-fg-subtle)',
};
const unreadPillStyle: CSSProperties = {
  minWidth: 18,
  height: 18,
  padding: '0 5px',
  borderRadius: 9,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg, #fff)',
  fontSize: 11,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const threadPaneStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};
const threadEmptyStyle: CSSProperties = {
  margin: 'auto',
  textAlign: 'center',
  color: 'var(--color-fg-muted)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};
const threadHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  borderBottom: '1px solid var(--color-border)',
};
const backBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-fg-muted)',
  fontSize: 22,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0 4px',
};
const threadListStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const baseBubble: CSSProperties = {
  maxWidth: '70%',
  padding: '8px 12px',
  borderRadius: 14,
  fontSize: 14,
  lineHeight: 1.4,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
const myBubbleStyle: CSSProperties = {
  ...baseBubble,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg, #fff)',
  borderBottomRightRadius: 4,
};
const theirBubbleStyle: CSSProperties = {
  ...baseBubble,
  background: 'var(--color-bg-elevated, #1e1e28)',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
  borderBottomLeftRadius: 4,
};
const systemBubbleStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-fg-subtle)',
  background: 'var(--color-bg-subtle)',
  padding: '3px 10px',
  borderRadius: 10,
};
const composerStyle: CSSProperties = {
  borderTop: '1px solid var(--color-border)',
  padding: '10px 12px 12px',
};
const inputRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 6,
};
const attachBtnStyle: CSSProperties = {
  width: 40,
  height: 40,
  flexShrink: 0,
  borderRadius: 10,
  background: 'transparent',
  color: 'var(--color-fg-muted)',
  border: '1px solid var(--color-border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};
const textareaStyle: CSSProperties = {
  flex: 1,
  resize: 'none',
  maxHeight: 120,
  padding: '9px 12px',
  borderRadius: 10,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-subtle)',
  color: 'var(--color-fg)',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
};
const sendBtnStyle: CSSProperties = {
  width: 40,
  height: 40,
  flexShrink: 0,
  borderRadius: 10,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg, #fff)',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
