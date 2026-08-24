/**
 * ChatWidget — burbuja de livechat del jugador (canal web del CRM).
 *
 * Se monta en el layout del player SOLO si CRM_ENABLED y hay sesión (ver
 * play/layout.tsx). Sigue el color del casino/socio via las CSS vars
 * `--color-accent` & co. (personalización por tenant intacta).
 *
 * Flujo: al conectar pide su conversación abierta + historial (`conversation:me`,
 * find-only), escucha `message:new` en vivo, y manda con `message:send`. Los
 * mensajes se deduplican por id (el propio message:send vuelve por la room).
 * Ver docs/22-crm-livechat.md y apps/api/src/chat.
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
import { MessageCircle, Paperclip, SendHorizontal, X } from 'lucide-react';
import { useChatSocket } from '@/lib/chat/use-chat-socket';
import { useIsDesktop } from '@/lib/hooks/use-is-desktop';
import type {
  ChatAttachment,
  ChatMessage,
  MessageNewEvent,
} from '@/lib/chat/types';
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_MAX_COUNT,
  uploadChatAttachment,
} from '@/lib/chat/upload';
import { MessageAttachments } from '@/components/chat/message-attachments';
import { AttachmentChips } from '@/components/chat/attachment-chips';

interface SendAck {
  ok: boolean;
  message?: ChatMessage;
  error?: string;
}
interface MeAck {
  ok: boolean;
  conversation?: { id: string } | null;
  messages?: ChatMessage[];
  error?: string;
}

export function ChatWidget(): React.ReactElement {
  const isDesktop = useIsDesktop();
  const { socket, status } = useChatSocket(true);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const openRef = useRef(open);
  openRef.current = open;
  const listEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) =>
      prev.some((x) => x.id === m.id)
        ? prev
        : [...prev, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }, []);

  /** Carga la conversación + historial (y marca leído) al (re)conectar. */
  const loadConversation = useCallback(() => {
    if (!socket) return;
    socket.emit('conversation:me', {}, (ack: MeAck) => {
      if (!ack?.ok) return;
      setConversationId(ack.conversation?.id ?? null);
      setMessages(
        (ack.messages ?? [])
          .slice()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      );
      if (openRef.current) setUnread(0);
    });
  }, [socket]);

  // Al conectar: cargar. (Se re-dispara en cada reconexión → rejoin + historial.)
  useEffect(() => {
    if (socket && status === 'connected') loadConversation();
  }, [socket, status, loadConversation]);

  // Mensajes entrantes en vivo.
  useEffect(() => {
    if (!socket) return;
    const onNew = (evt: MessageNewEvent) => {
      addMessage(evt.message);
      setConversationId(evt.conversationId);
      // Si el panel está cerrado y llega respuesta del operador → badge.
      if (!openRef.current && evt.message.direction === 'outbound') {
        setUnread((u) => u + 1);
      }
    };
    socket.on('message:new', onNew);
    return () => {
      socket.off('message:new', onNew);
    };
  }, [socket, addMessage]);

  // Auto-scroll al fondo cuando cambian los mensajes o se abre.
  useEffect(() => {
    if (open) listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setUnread(0);
        if (socket && status === 'connected') loadConversation();
      }
      return next;
    });
  }, [socket, status, loadConversation]);

  const emitTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket || !conversationId) return;
      socket.emit('typing', { conversationId, isTyping });
    },
    [socket, conversationId],
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
            // Un archivo que falla (tipo/tamaño) no corta los demás.
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

  const send = useCallback(() => {
    const body = draft.trim();
    if ((!body && pending.length === 0) || !socket || sending || uploading) {
      return;
    }
    setSending(true);
    socket.emit(
      'message:send',
      { body, attachments: pending },
      (ack: SendAck) => {
        setSending(false);
        if (ack?.ok && ack.message) {
          addMessage(ack.message);
          setConversationId(ack.message.conversationId);
          setDraft('');
          setPending([]);
          emitTyping(false);
        }
      },
    );
  }, [draft, pending, socket, sending, uploading, addMessage, emitTyping]);

  const statusMeta = useMemo(() => {
    if (status === 'connected')
      return { color: 'var(--color-success)', label: 'En línea' };
    if (status === 'connecting')
      return { color: 'var(--color-warning)', label: 'Conectando…' };
    return { color: 'var(--color-fg-subtle)', label: 'Sin conexión' };
  }, [status]);

  // Responsive: en mobile la burbuja se levanta por encima de la barra inferior
  // (64px) para no tapar botones (retiro, etc.), y el panel es pantalla completa
  // (más fácil de usar). En desktop se mantiene la burbuja + panel flotante.
  const bubble: CSSProperties = {
    ...bubbleStyle,
    bottom: isDesktop ? 20 : 84,
    right: isDesktop ? 20 : 16,
  };
  const panel: CSSProperties = isDesktop
    ? panelStyle
    : {
        ...panelStyle,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100dvh',
        borderRadius: 0,
        border: 'none',
        zIndex: 80,
      };
  const composer: CSSProperties = isDesktop
    ? composerStyle
    : {
        ...composerStyle,
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
      };

  return (
    <>
      {/* Panel */}
      {open && (
        <div style={panel} role="dialog" aria-label="Chat de soporte">
          {/* Header */}
          <div style={headerStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Soporte</span>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: statusMeta.color,
                }}
                title={statusMeta.label}
              />
              <span style={{ fontSize: 11, color: 'var(--color-accent-fg)', opacity: 0.8 }}>
                {statusMeta.label}
              </span>
            </div>
            <button
              onClick={toggleOpen}
              aria-label="Cerrar chat"
              style={iconBtnStyle}
            >
              <X size={18} />
            </button>
          </div>

          {/* Mensajes */}
          <div style={listStyle}>
            {messages.length === 0 ? (
              <div style={emptyStyle}>
                <MessageCircle size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                <p style={{ margin: 0, fontSize: 13 }}>
                  ¿En qué podemos ayudarte? Escribinos y te respondemos.
                </p>
              </div>
            ) : (
              messages.map((m) => <Bubble key={m.id} message={m} />)
            )}
            <div ref={listEndRef} />
          </div>

          {/* Composer */}
          <div style={composer}>
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
                    send();
                  }
                }}
                placeholder="Escribí tu mensaje…"
                rows={1}
                style={textareaStyle}
              />
              <button
                onClick={send}
                disabled={
                  (!draft.trim() && pending.length === 0) || sending || uploading
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
        </div>
      )}

      {/* Burbuja flotante. En mobile, con el panel abierto (pantalla completa),
          la burbuja se oculta: el header del panel ya tiene su botón de cerrar. */}
      {(isDesktop || !open) && (
        <button
          onClick={toggleOpen}
          aria-label={open ? 'Cerrar chat' : 'Abrir chat de soporte'}
          style={bubble}
        >
          {open ? <X size={24} /> : <MessageCircle size={24} />}
          {!open && unread > 0 && (
            <span style={badgeStyle}>{unread > 9 ? '9+' : unread}</span>
          )}
        </button>
      )}
    </>
  );
}

/** Burbuja de un mensaje. inbound = el jugador (derecha); outbound = operador (izq). */
function Bubble({ message }: { message: ChatMessage }): React.ReactElement {
  const mine = message.direction === 'inbound';
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

// ── Estilos (inline para ganarle a las cascade-layers de Tailwind v4) ────────

const bubbleStyle: CSSProperties = {
  position: 'fixed',
  bottom: 20,
  right: 20,
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg, #fff)',
  border: 'none',
  boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  zIndex: 60,
};

const badgeStyle: CSSProperties = {
  position: 'absolute',
  top: -2,
  right: -2,
  minWidth: 20,
  height: 20,
  padding: '0 5px',
  borderRadius: 10,
  background: 'var(--color-danger)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '2px solid var(--color-bg)',
};

const panelStyle: CSSProperties = {
  position: 'fixed',
  bottom: 88,
  right: 20,
  width: 'min(370px, calc(100vw - 32px))',
  height: 'min(540px, calc(100vh - 130px))',
  background: 'var(--color-bg, #14141a)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zIndex: 60,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 14px',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg, #fff)',
};

const iconBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  display: 'flex',
  padding: 2,
  opacity: 0.85,
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--color-bg)',
};

const emptyStyle: CSSProperties = {
  margin: 'auto',
  textAlign: 'center',
  color: 'var(--color-fg-muted)',
  maxWidth: 220,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const baseBubble: CSSProperties = {
  maxWidth: '78%',
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
  background: 'var(--color-bg)',
  padding: '8px 10px 10px',
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
  borderRadius: 12,
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
  maxHeight: 96,
  padding: '9px 12px',
  borderRadius: 12,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-subtle, #1a1a22)',
  color: 'var(--color-fg)',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
};

const sendBtnStyle: CSSProperties = {
  width: 40,
  height: 40,
  flexShrink: 0,
  borderRadius: 12,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg, #fff)',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
