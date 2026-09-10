/**
 * La bandeja del operador: estado, socket y acciones. Sin nada de interfaz.
 *
 * ## Por qué existe
 *
 * Hay **dos vistas** de la misma bandeja:
 *
 *   - `components/admin/chat/operator-inbox.tsx` — la que se ve entrando por
 *     el panel (`admin.`), adentro de una página con padding que scrollea con
 *     el body.
 *   - `components/admin/crm/bandeja.tsx` — la del CRM (`crm.`), de alto fijo y
 *     tres columnas que scrollean por separado, según el handoff de diseño.
 *
 * Son dos layouts distintos sobre **exactamente la misma conversación**: los
 * mismos eventos de socket, el mismo borrador, los mismos adjuntos, el mismo
 * "está escribiendo". Con el manejo del socket copiado en cada una, cualquier
 * arreglo —un evento nuevo, un caso de reconexión, un ack que cambia de forma—
 * se hace en una y se olvida en la otra. La que quede vieja no explota: se
 * porta distinto, que es peor de encontrar.
 *
 * Por eso la lógica vive acá una sola vez y las vistas sólo dibujan.
 *
 * ## Lo que NO está acá
 *
 * Lo que es decisión de cada vista: qué columna está abierta, si el panel de
 * plantillas se ve, la densidad de la lista. Eso no es la bandeja, es cómo se
 * la mira.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatSocket } from './use-chat-socket';
import type {
  ChatAttachment,
  ChatMessage,
  InboxItem,
  MessageNewEvent,
  TypingEvent,
} from './types';
import {
  CHAT_ATTACHMENT_MAX_COUNT,
  uploadChatAttachment,
} from './upload';

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

/** El nombre que se le muestra a un contacto, con los respaldos en orden. */
export function nombreDelContacto(item: InboxItem): string {
  const c = item.contact;
  return (
    c.userDisplayName ??
    c.username ??
    c.displayName ??
    c.phone ??
    (c.isLead ? 'Lead anónimo' : 'Jugador')
  );
}

export function useBandeja() {
  const { socket, status } = useChatSocket(true);
  const [conversations, setConversations] = useState<InboxItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [contactTyping, setContactTyping] = useState(false);
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  /** Por qué no se pudo mandar lo último que intentó. */
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  // Los refs espejan el estado para poder leerlo adentro de los handlers del
  // socket, que se registran una vez y capturarían el valor viejo.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const convRef = useRef<InboxItem[]>([]);
  convRef.current = conversations;
  const listEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingClear = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) =>
      prev.some((x) => x.id === m.id)
        ? prev
        : [...prev, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }, []);

  /**
   * Qué está mostrando la lista: lo abierto, o el historial de resueltas.
   *
   * Son **dos consultas distintas**, no un filtro sobre la misma. Con el tope
   * de 100 filas, un historial de conversaciones cerradas le comería el lugar a
   * las abiertas — que son las que alguien está esperando que le contesten.
   */
  const [viendoResueltas, setViendoResueltas] = useState(false);
  const [cargandoLista, setCargandoLista] = useState(false);

  const loadInbox = useCallback(
    (resueltas = viendoResueltas) => {
      if (!socket) return;
      setCargandoLista(true);
      socket.emit('conversation:list', { resueltas }, (ack: ListAck) => {
        setCargandoLista(false);
        if (ack?.ok) setConversations(ack.conversations ?? []);
      });
    },
    [socket, viendoResueltas],
  );

  /** Cambia entre lo abierto y el historial, y recarga. */
  const verResueltas = useCallback(
    (resueltas: boolean) => {
      setViendoResueltas(resueltas);
      // La selección es de la lista anterior: al cambiar de conjunto ya no
      // pertenece a lo que se está viendo.
      setSelectedId(null);
      setMessages([]);
      loadInbox(resueltas);
    },
    [loadInbox],
  );

  // Al (re)conectar: cargar la bandeja.
  useEffect(() => {
    // `loadInbox` no está en las deps a propósito: cambia con `viendoResueltas`
    // y recargaría al cambiar de pestaña por duplicado — de eso ya se encarga
    // `verResueltas`. Acá sólo interesa el (re)conectar.
    if (socket && status === 'connected') loadInbox();
  }, [socket, status]);

  const selectConversation = useCallback(
    (id: string) => {
      if (!socket) return;
      setSelectedId(id);
      setContactTyping(false);
      setPending([]);
      setDraft('');
      // El error es de la conversación anterior: acá ya no significa nada.
      setErrorEnvio(null);
      socket.emit('conversation:open', { conversationId: id }, (ack: OpenAck) => {
        if (!ack?.ok) return;
        setMessages(
          (ack.messages ?? [])
            .slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        );
      });
      // Marcar leído localmente en la lista.
      setConversations((prev) =>
        prev.map((c) =>
          c.conversation.id === id
            ? { ...c, conversation: { ...c.conversation, unreadForOperator: 0 } }
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
          const item = prev.find((c) => c.conversation.id === evt.conversationId);
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
          // La conversación actualizada va al tope.
          const rest = prev.filter((c) => c.conversation.id !== evt.conversationId);
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

  /** Inserta el cuerpo de una plantilla en el borrador (lo agrega si ya hay texto). */
  const insertTemplate = useCallback((body: string) => {
    setDraft((d) => (d.trim() ? `${d.trimEnd()}\n${body}` : body));
    // Devolvemos el foco al compositor para seguir editando.
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

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
          setErrorEnvio(null);
          addMessage(ack.message);
          setDraft('');
          setPending([]);
          emitTyping(false);
          return;
        }
        // Si el envío se rechaza hay que decirlo: antes el spinner paraba y no
        // pasaba nada, y el operador volvía a apretar sin entender. El borrador
        // NO se limpia — lo que escribió sigue ahí para reintentar.
        setErrorEnvio(ack?.error ?? 'No se pudo enviar el mensaje.');
      },
    );
  }, [draft, pending, socket, selectedId, sending, uploading, addMessage, emitTyping]);

  const selected =
    conversations.find((c) => c.conversation.id === selectedId) ?? null;

  return {
    // Estado
    //
    // El `socket` NO sale de acá a propósito. Aparte de que su tipo no se puede
    // nombrar desde afuera sin arrastrar `@socket.io/component-emitter`, es un
    // detalle de esta implementación: si una vista pudiera emitir eventos por su
    // cuenta, volveríamos a tener lógica de conversación repartida — que es
    // justo lo que este hook viene a juntar. Lo que haga falta emitir se agrega
    // acá como una acción más.
    status,
    conversations,
    viendoResueltas,
    cargandoLista,
    selected,
    selectedId,
    messages,
    draft,
    sending,
    contactTyping,
    pending,
    uploading,
    errorEnvio,
    // Refs que la vista tiene que enchufar a sus nodos
    listEndRef,
    fileInputRef,
    textareaRef,
    // Acciones
    setSelectedId,
    selectConversation,
    verResueltas,
    onDraftChange,
    onPickFiles,
    removePending,
    insertTemplate,
    reply,
  };
}
