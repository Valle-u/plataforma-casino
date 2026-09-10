/**
 * La columna del medio: cabecera, hilo y compositor.
 *
 * ## Lo que se dejó afuera, y por qué
 *
 * El diseño trae en el compositor un selector **Responder / Nota interna**, con
 * el textarea teñido de ámbar y burbujas centradas que dicen "NO LE LLEGA AL
 * JUGADOR". No está: las notas internas sobre una conversación **no existen en
 * el backend**. Hay notas sobre el *contacto* (`crm_notes`), que es otra cosa.
 *
 * Construir el selector sin eso daría un modo que guarda el texto como mensaje
 * normal — o sea, **se lo manda al jugador**. Un adorno con esa consecuencia no
 * se pone.
 *
 * **Las respuestas rápidas sí están**, con el botón del rayo. Lo que no está es
 * la fila de atajos tipeables (`/deposito`, `/alias`) del diseño: disparar la
 * plantilla escribiendo la barra adentro del mensaje pelea con el atajo `/`
 * global —que lleva el foco al compositor— y hay que resolver esa convivencia
 * antes, no después.
 *
 * ## El scroll
 *
 * El hilo scrollea solo; la cabecera y el compositor quedan fijos. Es lo que
 * permite el alto fijo del shell, y la razón de que la bandeja no viva dentro
 * de una página que scrollea con el body.
 */

'use client';

import {
  ArrowLeft,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  SendHorizontal,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import type { ChatMessage } from '@/lib/chat/types';
import type { useBandeja } from '@/lib/chat/use-bandeja';
import { nombreDelContacto } from '@/lib/chat/use-bandeja';
import { canalVisible } from '@/lib/crm/canales';
import { cn } from '@/lib/cn';
import { MessageAttachments } from '@/components/chat/message-attachments';
import { AttachmentChips } from '@/components/chat/attachment-chips';
import { CHAT_ATTACHMENT_ACCEPT } from '@/lib/chat/upload';
import { listTemplates } from '@/lib/chat/crm-api';
import { useEffect, useState } from 'react';
import type { CrmTemplate } from '@/lib/chat/types';

export function Conversacion({
  bandeja,
  onVolver,
  fichaAbierta,
  onAlternarFicha,
}: {
  bandeja: ReturnType<typeof useBandeja>;
  /** En mobile, la flecha para volver a la lista. `null` en escritorio. */
  onVolver: (() => void) | null;
  fichaAbierta: boolean;
  onAlternarFicha: () => void;
}): React.ReactElement {
  const {
    selected,
    messages,
    draft,
    sending,
    contactTyping,
    pending,
    uploading,
    errorEnvio,
    listEndRef,
    fileInputRef,
    textareaRef,
    onDraftChange,
    onPickFiles,
    removePending,
    reply,
  } = bandeja;

  const [plantillasAbiertas, setPlantillasAbiertas] = useState(false);

  if (!selected) return <div className="h-full" />;

  const nombre = nombreDelContacto(selected);
  const canal = canalVisible(selected.channelType);
  const handle = selected.contact.username ?? selected.contact.phone;

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)]">
      {/* ── Cabecera ───────────────────────────────────────────────────── */}
      <div className="flex h-[62px] shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] px-3">
        {onVolver && (
          <button
            type="button"
            onClick={onVolver}
            aria-label="Volver a la lista"
            className="flex size-8 items-center justify-center rounded-[9px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]"
          >
            <ArrowLeft size={17} />
          </button>
        )}

        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ background: 'var(--color-bg-subtle)', color: canal.color }}
        >
          {nombre.charAt(0).toUpperCase()}
        </span>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-[15px] font-bold text-[var(--color-fg)]">
              {nombre}
            </span>
            {canal.label && (
              <span
                className="shrink-0 rounded-[7px] px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.1em]"
                style={{ color: canal.color, background: 'var(--color-bg-subtle)' }}
              >
                {canal.label}
              </span>
            )}
          </div>
          <span className="truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">
            {contactTyping ? 'escribiendo…' : (handle ?? '')}
          </span>
        </div>

        <button
          type="button"
          onClick={onAlternarFicha}
          aria-label={fichaAbierta ? 'Ocultar la ficha' : 'Mostrar la ficha'}
          title={fichaAbierta ? 'Ocultar la ficha' : 'Mostrar la ficha'}
          className="ml-auto hidden size-8 items-center justify-center rounded-[9px] text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] md:flex"
        >
          {fichaAbierta ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>

      {/* ── Hilo ───────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {messages.map((m, i) => (
          <Burbuja
            key={m.id}
            mensaje={m}
            // El separador de fecha va cuando cambia el día respecto del
            // anterior, no cada tantos mensajes.
            fechaNueva={esOtroDia(messages[i - 1]?.createdAt, m.createdAt)}
          />
        ))}
        {contactTyping && (
          <div className="flex justify-start">
            <div className="rounded-[14px] bg-[var(--color-bg-elevated)] px-3 py-2 text-[13.5px] text-[var(--color-fg-muted)]">
              …
            </div>
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      {/* ── Compositor ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-[var(--color-border)] px-3 py-2.5">
        {errorEnvio && (
          <div
            role="alert"
            className="mb-2 flex gap-1.5 rounded-[12px] border-l-2 border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-2 py-1.5 text-[11.5px] text-[var(--color-warning)]"
          >
            <TriangleAlert size={12} className="mt-px shrink-0" />
            <span>{errorEnvio}</span>
          </div>
        )}

        {plantillasAbiertas && (
          <Plantillas
            onElegir={(cuerpo) => {
              // Se agrega al borrador en vez de pisarlo: casi siempre la
              // plantilla es parte de la respuesta, no toda la respuesta.
              onDraftChange(draft.trim() ? `${draft.trimEnd()}\n${cuerpo}` : cuerpo);
              setPlantillasAbiertas(false);
              setTimeout(() => textareaRef.current?.focus(), 0);
            }}
            onCerrar={() => setPlantillasAbiertas(false)}
          />
        )}

        <AttachmentChips
          attachments={pending}
          uploading={uploading}
          onRemove={removePending}
        />

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={CHAT_ATTACHMENT_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Adjuntar un archivo"
            title="Adjuntar un archivo"
            className="flex size-[38px] shrink-0 items-center justify-center rounded-[11px] text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]"
          >
            <Paperclip size={16} />
          </button>

          <button
            type="button"
            onClick={() => setPlantillasAbiertas((v) => !v)}
            aria-label="Respuestas rápidas"
            title="Respuestas rápidas"
            className={cn(
              'flex size-[38px] shrink-0 items-center justify-center rounded-[11px] transition-colors hover:bg-[var(--color-bg-subtle)]',
              plantillasAbiertas
                ? 'text-[var(--color-accent-text)]'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
            )}
          >
            <Zap size={16} />
          </button>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter manda, Shift+Enter hace salto de línea. Es lo que la
              // gente espera de un chat, y lo que dice la ayuda de abajo.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                reply();
              }
            }}
            rows={1}
            placeholder="Escribí tu respuesta"
            className="max-h-[120px] min-h-[42px] flex-1 resize-none rounded-[11px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2.5 text-[13.5px] text-[var(--color-fg)] outline-none transition-colors focus:border-[var(--color-border-strong)] placeholder:text-[var(--color-fg-subtle)]"
          />

          <button
            type="button"
            onClick={reply}
            disabled={sending || uploading || (!draft.trim() && pending.length === 0)}
            className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-[11px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-[var(--color-accent-fg)] transition-opacity disabled:opacity-40"
          >
            <SendHorizontal size={15} />
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>

        <p className="mt-1.5 text-[11px] text-[var(--color-fg-subtle)]">
          Enter envía · Shift+Enter nueva línea
        </p>
      </div>
    </div>
  );
}

/** Una burbuja del hilo, con su separador de fecha si arranca un día nuevo. */
function Burbuja({
  mensaje,
  fechaNueva,
}: {
  mensaje: ChatMessage;
  fechaNueva: boolean;
}): React.ReactElement {
  const mia = mensaje.direction === 'outbound';
  const sistema = mensaje.direction === 'system';

  return (
    <>
      {fechaNueva && (
        <div className="my-1 flex justify-center">
          <span className="rounded-[8px] bg-[var(--color-bg-elevated)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--color-fg-subtle)]">
            {fecha(mensaje.createdAt)}
          </span>
        </div>
      )}

      {sistema ? (
        <div className="flex justify-center">
          <span className="max-w-[80%] rounded-[12px] bg-[var(--color-bg-elevated)] px-2.5 py-1 text-center text-[11.5px] text-[var(--color-fg-muted)]">
            {mensaje.body}
          </span>
        </div>
      ) : (
        <div className={cn('flex', mia ? 'justify-end' : 'justify-start')}>
          <div className="max-w-[70%]">
            <div
              className={cn(
                'whitespace-pre-wrap break-words rounded-[14px] px-3 py-2 text-[13.5px] leading-[1.4]',
                mia
                  ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)]'
                  : 'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg)]',
              )}
            >
              {mensaje.body}
              <MessageAttachments attachments={mensaje.attachments} />
            </div>

            {/* No llegó (2.7). Sin esto, una respuesta que Telegram rechazó se
                ve igual que cualquier otra y el operador cree que llegó. */}
            {mensaje.deliveryError && (
              <div
                role="alert"
                className="mt-1 flex gap-1.5 rounded-[9px] border-l-2 border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-2 py-1 text-[11px] text-[var(--color-warning)]"
              >
                <TriangleAlert size={11} className="mt-px shrink-0" />
                <span>
                  <b>No llegó.</b> {mensaje.deliveryError}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function esOtroDia(anterior: string | undefined, actual: string): boolean {
  if (!anterior) return true;
  return new Date(anterior).toDateString() !== new Date(actual).toDateString();
}

function fecha(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return 'Hoy';
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * El panel de respuestas rápidas del compositor.
 *
 * Se piden al abrirlo y no al montar la conversación: la mayoría de las
 * respuestas se escriben a mano, así que traer el catálogo en cada conversación
 * sería una consulta que casi nunca se usa.
 */
function Plantillas({
  onElegir,
  onCerrar,
}: {
  onElegir: (cuerpo: string) => void;
  onCerrar: () => void;
}): React.ReactElement {
  const [items, setItems] = useState<CrmTemplate[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    listTemplates()
      .then((t) => vivo && setItems(t))
      .catch(() => vivo && setItems([]))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="mb-2 max-h-[220px] overflow-y-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1.5">
      {cargando ? (
        <p className="px-2 py-2 text-[12px] text-[var(--color-fg-subtle)]">
          Cargando…
        </p>
      ) : items.length === 0 ? (
        <p className="px-2 py-2 text-[12px] leading-snug text-[var(--color-fg-muted)]">
          Todavía no hay respuestas rápidas. Se crean en{' '}
          <b>Respuestas rápidas</b>, en el menú.
        </p>
      ) : (
        items.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onElegir(t.body)}
            className="flex w-full flex-col gap-0.5 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-bg-subtle)]"
          >
            <span className="flex items-center gap-1.5">
              {t.shortcut && (
                <span className="font-mono text-[11px] text-[var(--color-accent-text)]">
                  {t.shortcut}
                </span>
              )}
              <span className="text-[12.5px] font-semibold text-[var(--color-fg)]">
                {t.title}
              </span>
            </span>
            <span className="line-clamp-2 text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
              {t.body}
            </span>
          </button>
        ))
      )}
      <button
        type="button"
        onClick={onCerrar}
        className="mt-1 w-full rounded-[9px] px-2 py-1 text-[11.5px] text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-subtle)]"
      >
        Cerrar
      </button>
    </div>
  );
}
