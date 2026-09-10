/**
 * La columna de conversaciones: buscador, pestañas, filtro de canal y filas.
 *
 * ## Lo que todavía no se puede mostrar
 *
 * El diseño pide en cada fila el **preview del último mensaje** y las
 * **etiquetas**. Ninguno de los dos viene hoy en la respuesta de la bandeja:
 *
 *   - El preview necesita el último mensaje de cada conversación. Traerlo mal
 *     —una consulta por fila— son cien consultas para abrir la bandeja.
 *   - Las etiquetas necesitan cruzar `crm_contact_tags`.
 *
 * Los dos son agregados al backend, no cosas que se puedan inventar acá. La
 * fila se arma con lo que hay y **no deja huecos**: sin preview, el nombre y la
 * hora ocupan la fila entera en vez de dejar una línea vacía debajo.
 *
 * ## La densidad no es un capricho
 *
 * Un operador con veinte conversaciones abiertas necesita verlas todas sin
 * scrollear. El modo compacto achica el padding y esconde las etiquetas — no
 * achica el nombre, que es lo que se lee para elegir.
 */

'use client';

import { PanelLeftClose, Rows3, Search } from 'lucide-react';
import type { InboxItem } from '@/lib/chat/types';
import { nombreDelContacto } from '@/lib/chat/use-bandeja';
import { CANALES, canalVisible } from '@/lib/crm/canales';
import { cn } from '@/lib/cn';
import type { PestanaDeBandeja } from './bandeja';

const PESTANAS: { id: PestanaDeBandeja; label: string }[] = [
  { id: 'abiertas', label: 'Abiertas' },
  { id: 'esperando', label: 'Esperando' },
  { id: 'resueltas', label: 'Resueltas' },
];

export function ListaDeConversaciones({
  items,
  total,
  seleccionada,
  onElegir,
  pestana,
  onPestana,
  canal,
  onCanal,
  busqueda,
  onBusqueda,
  densa,
  onDensa,
  onColapsar,
  cargando,
  estado,
}: {
  items: InboxItem[];
  total: number;
  seleccionada: string | null;
  onElegir: (id: string) => void;
  pestana: PestanaDeBandeja;
  onPestana: (p: PestanaDeBandeja) => void;
  canal: string | null;
  onCanal: (c: string | null) => void;
  busqueda: string;
  onBusqueda: (v: string) => void;
  densa: boolean;
  onDensa: () => void;
  /** `null` en mobile, donde no hay columnas que colapsar. */
  onColapsar: (() => void) | null;
  cargando: boolean;
  estado: string;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      {/* ── Título ─────────────────────────────────────────────────────── */}
      <div className="flex h-[46px] shrink-0 items-center gap-2 px-3">
        <span className="font-display text-[14px] font-bold text-[var(--color-fg)]">
          Conversaciones
        </span>
        <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
          {total}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onDensa}
            aria-pressed={densa}
            title={densa ? 'Filas normales' : 'Filas compactas'}
            className={cn(
              'flex size-7 items-center justify-center rounded-[9px] transition-colors hover:bg-[var(--color-bg-subtle)]',
              densa ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg-muted)]',
            )}
          >
            <Rows3 size={14} />
          </button>
          {onColapsar && (
            <button
              type="button"
              onClick={onColapsar}
              aria-label="Colapsar la lista"
              title="Colapsar la lista"
              className="flex size-7 items-center justify-center rounded-[9px] text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]"
            >
              <PanelLeftClose size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Buscador ───────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pb-2">
        <div className="flex h-[38px] items-center gap-2 rounded-[11px] bg-[var(--color-bg-subtle)] px-2.5">
          <Search size={14} className="shrink-0 text-[var(--color-fg-subtle)]" />
          <input
            value={busqueda}
            onChange={(e) => onBusqueda(e.target.value)}
            placeholder="Buscar por nombre o teléfono"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)]"
          />
        </div>
      </div>

      {/* ── Pestañas ───────────────────────────────────────────────────── */}
      <div className="flex shrink-0 gap-1 border-b border-[var(--color-border)] px-3">
        {PESTANAS.map((p) => {
          const activa = p.id === pestana;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPestana(p.id)}
              className={cn(
                'relative -mb-px border-b-2 px-2 pb-2 pt-1 text-[12.5px] transition-colors',
                activa
                  ? 'border-[var(--color-accent)] font-semibold text-[var(--color-fg)]'
                  : 'border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
              )}
            >
              {p.label}
              {/* El contador sólo tiene sentido en la pestaña que se está
                  mirando: las otras dos salen de una consulta que no se hizo. */}
              {activa && (
                <span className="ml-1.5 font-mono text-[11px] text-[var(--color-fg-subtle)]">
                  {items.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Filtro de canal ────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap gap-1.5 px-3 py-2">
        <ChipDeCanal activo={canal === null} onClick={() => onCanal(null)} label="Todos" />
        {CANALES.map((c) => (
          <ChipDeCanal
            key={c.tipo}
            activo={canal === c.tipo}
            onClick={() => onCanal(canal === c.tipo ? null : c.tipo)}
            label={c.label}
            color={c.color}
          />
        ))}
      </div>

      {/* ── Filas ──────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {cargando ? (
          <Esqueletos densa={densa} />
        ) : items.length === 0 ? (
          <Vacio pestana={pestana} filtrando={!!canal || busqueda.trim() !== ''} estado={estado} />
        ) : (
          items.map((item) => (
            <Fila
              key={item.conversation.id}
              item={item}
              activa={item.conversation.id === seleccionada}
              densa={densa}
              onClick={() => onElegir(item.conversation.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ChipDeCanal({
  activo,
  onClick,
  label,
  color,
}: {
  activo: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-[26px] items-center gap-1.5 rounded-[9px] px-2 text-[11.5px] transition-colors',
        activo
          ? 'bg-[var(--color-bg-active,#1c1c1c)] font-medium text-[var(--color-fg)]'
          : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]',
      )}
    >
      {color && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: color }}
        />
      )}
      {label}
    </button>
  );
}

/** Una conversación en la lista. */
function Fila({
  item,
  activa,
  densa,
  onClick,
}: {
  item: InboxItem;
  activa: boolean;
  densa: boolean;
  onClick: () => void;
}): React.ReactElement {
  const nombre = nombreDelContacto(item);
  const canal = canalVisible(item.channelType);
  const sinLeer = item.conversation.unreadForOperator;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex w-full items-start gap-2.5 border-b border-[var(--color-border)] text-left transition-colors',
        densa ? 'gap-2 px-[18px] py-[9px]' : 'px-3 py-2.5',
        activa ? 'bg-[var(--color-bg-subtle)]' : 'hover:bg-[var(--color-bg-subtle)]',
      )}
    >
      {/* El riel de 3px es lo que marca la fila elegida. El fondo solo no
          alcanza: con la lista angosta se confunde con el hover. */}
      {activa && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-[var(--color-accent)]"
        />
      )}

      <span
        aria-hidden
        className="mt-0.5 flex size-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{ background: 'var(--color-bg-subtle)', color: canal.color }}
      >
        {nombre.charAt(0).toUpperCase()}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          {canal.label && (
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
              {canal.label}
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--color-fg-subtle)]">
            {hora(item.conversation.lastMessageAt)}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--color-fg)]">
            {nombre}
          </span>
          {sinLeer > 0 && (
            <span className="shrink-0 rounded-[7px] bg-[var(--color-accent)] px-1.5 py-px font-mono text-[10.5px] font-semibold text-[var(--color-accent-fg)]">
              {sinLeer > 9 ? '9+' : sinLeer}
            </span>
          )}
        </span>

        {/* El preview va siempre, también en compacto: es lo que hace que la
            lista sirva para elegir sin abrir cada conversación. Lo que se
            esconde en compacto son las etiquetas. */}
        <span className="truncate text-[12px] text-[var(--color-fg-muted)]">
          {preview(item)}
        </span>

        {!densa && item.tags && item.tags.length > 0 && (
          <span className="flex flex-wrap gap-1 pt-0.5">
            {item.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-[7px] px-1.5 py-px text-[10px] font-medium"
                style={{
                  // El color de la etiqueta lo elige el operador y puede ser
                  // cualquiera: se usa como tinte del texto sobre un fondo
                  // neutro, no como fondo. Así ninguna combinación queda
                  // ilegible.
                  color: t.color ?? 'var(--color-fg-muted)',
                  background: 'var(--color-bg-subtle)',
                }}
              >
                {t.label}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Qué mostrar como preview de la fila.
 *
 * Tres casos distintos, y los tres se dicen distinto:
 *
 *   - **Sin mensajes** → si es un lead o un jugador. Es lo único que se sabe.
 *   - **Cuerpo vacío** → el último mensaje era sólo un archivo. No se deja la
 *     línea en blanco: parecería que el preview no cargó.
 *   - **Con texto** → el texto. El salto de línea se aplana porque la fila es
 *     de una sola línea y con `\n` el `truncate` corta en el lugar equivocado.
 */
function preview(item: InboxItem): string {
  const body = item.lastMessageBody;
  if (body === null || body === undefined) {
    return item.contact.isLead ? 'Lead' : 'Jugador';
  }
  const texto = body.replace(/\s+/g, ' ').trim();
  return texto || 'Archivo adjunto';
}

/** La hora del último mensaje. Vacío si la conversación no tuvo ninguno. */
function hora(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  // De hoy, la hora; de antes, la fecha. Ver "14:32" en algo de la semana
  // pasada hace pensar que es reciente.
  return mismoDia
    ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

/**
 * Vacíos distintos según por qué está vacío.
 *
 * "No hay nada" y "tu filtro no encontró nada" son dos situaciones muy
 * distintas, y con el mismo cartel el operador no sabe si sacar el filtro o
 * esperar a que alguien escriba.
 */
function Vacio({
  pestana,
  filtrando,
  estado,
}: {
  pestana: PestanaDeBandeja;
  filtrando: boolean;
  estado: string;
}): React.ReactElement {
  if (estado !== 'connected') {
    return (
      <p className="px-4 py-6 text-center text-[12.5px] text-[var(--color-fg-muted)]">
        {estado === 'connecting' ? 'Conectando…' : 'Sin conexión con el chat.'}
      </p>
    );
  }
  const texto = filtrando
    ? 'Ninguna conversación coincide con el filtro.'
    : pestana === 'resueltas'
      ? 'Todavía no resolviste ninguna conversación.'
      : pestana === 'esperando'
        ? 'No hay conversaciones esperando respuesta.'
        : 'No tenés conversaciones abiertas.';
  return (
    <p className="px-4 py-6 text-center text-[12.5px] text-[var(--color-fg-muted)]">
      {texto}
    </p>
  );
}

/** Esqueletos mientras carga, para que el cambio de pestaña no parpadee vacío. */
function Esqueletos({ densa }: { densa: boolean }): React.ReactElement {
  return (
    <div aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={cn(
            'flex items-start gap-2.5 border-b border-[var(--color-border)]',
            densa ? 'px-[18px] py-[9px]' : 'px-3 py-2.5',
          )}
        >
          <div className="size-[26px] shrink-0 animate-pulse rounded-full bg-[var(--color-bg-subtle)]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-2 w-16 animate-pulse rounded bg-[var(--color-bg-subtle)]" />
            <div className="h-3 w-32 animate-pulse rounded bg-[var(--color-bg-subtle)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
