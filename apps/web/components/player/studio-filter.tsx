/**
 * StudioFilter — filtro por estudio del lobby.
 *
 * Por qué existe como componente y no como una fila de chips más:
 *
 * Cuando el filtro era Palace-only mostraba ~17 estudios y una fila que
 * envolvía alcanzaba. Al unificar los tres proveedores (migración 0107) pasaron
 * a ser **46 y subiendo**: 46 chips de golpe son una pared que empuja el grid
 * de juegos abajo del fold, y en celular ocupan media pantalla.
 *
 * Diseño:
 *   - Se muestran los MÁS JUGADOS (por cantidad de juegos) en una sola fila que
 *     scrollea en horizontal — nunca envuelve, así la altura es estable y no
 *     salta al cambiar de categoría.
 *   - El resto vive detrás de un botón "+N", que abre un buscador. Con 46
 *     estudios buscar es más rápido que barrer una lista con la vista.
 *   - El estudio elegido SIEMPRE se ve como chip, aunque no esté entre los más
 *     jugados: si no, el filtro activo queda invisible y se siente roto.
 *
 * Mobile: el buscador es un ActionSheet (bottom sheet, alcanzable con el
 * pulgar). Desktop: un Modal centrado.
 */

'use client';

import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Modal } from '@/components/ui/modal';
import { useIsDesktop } from '@/lib/hooks/use-is-desktop';
import { cn } from '@/lib/cn';

export interface StudioOption {
  id: string;
  name: string;
  count: number;
}

/**
 * Cuántos chips se muestran antes de mandar el resto al buscador.
 *
 * Seis entran en una pantalla de celular sin que la fila se sienta un carrusel
 * infinito, y cubren la mayoría de los casos: los primeros estudios concentran
 * gran parte del catálogo.
 */
const VISIBLE_CHIPS = 6;

/**
 * Si sobran POCOS estudios no vale la pena esconderlos: un "+2" que abre un
 * modal para elegir entre dos opciones molesta más de lo que ayuda.
 */
const MIN_HIDDEN_TO_COLLAPSE = 3;

export function StudioFilter({
  studios,
  value,
  onChange,
}: {
  studios: StudioOption[];
  /** `'all'` o el id (= nombre) del estudio elegido. */
  value: string;
  onChange: (next: string) => void;
}) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { chips, hiddenCount } = useMemo(() => {
    const collapse = studios.length > VISIBLE_CHIPS + MIN_HIDDEN_TO_COLLAPSE;
    if (!collapse) return { chips: studios, hiddenCount: 0 };

    const top = studios.slice(0, VISIBLE_CHIPS);
    // El seleccionado siempre visible, aunque no esté entre los más jugados.
    const selected = studios.find((s) => s.id === value);
    const list =
      selected && !top.some((s) => s.id === selected.id)
        ? [...top, selected]
        : top;
    return { chips: list, hiddenCount: studios.length - top.length };
  }, [studios, value]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return studios;
    return studios.filter((s) => s.name.toLowerCase().includes(q));
  }, [studios, query]);

  if (studios.length === 0) return null;

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery('');
  }

  const picker = (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar estudio…"
          // Autofocus solo en desktop: en celular abre el teclado y tapa la
          // lista justo cuando el jugador quiere verla.
          autoFocus={isDesktop}
          className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] pl-9 pr-8 text-[13px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="max-h-[45dvh] overflow-y-auto">
        <StudioOptionRow
          label="Todos los estudios"
          active={value === 'all'}
          onClick={() => pick('all')}
        />
        {results.map((s) => (
          <StudioOptionRow
            key={s.id}
            label={s.name}
            count={s.count}
            active={value === s.id}
            onClick={() => pick(s.id)}
          />
        ))}
        {results.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] text-[var(--color-fg-subtle)]">
            Ningún estudio coincide con la búsqueda.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
        Estudio
      </span>

      {/* Fila que scrollea en horizontal — nunca envuelve, así la altura del
          bloque no salta al cambiar de categoría. El margen negativo deja que
          el scroll llegue al borde de la pantalla en celular. */}
      <div className="-mx-4 flex snap-x items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:thin]">
        <StudioChip
          label="Todos"
          active={value === 'all'}
          onClick={() => onChange('all')}
        />
        {chips.map((s) => (
          <StudioChip
            key={s.id}
            label={s.name}
            count={s.count}
            active={value === s.id}
            onClick={() => onChange(s.id)}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 shrink-0 snap-start items-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] px-3 text-[12px] whitespace-nowrap text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <Search className="size-3.5" />
            +{hiddenCount} más
          </button>
        )}
      </div>

      {isDesktop ? (
        <Modal
          open={open}
          onOpenChange={setOpen}
          title="Elegí un estudio"
          description={`${studios.length} estudios en esta categoría`}
          size="md"
        >
          {picker}
        </Modal>
      ) : (
        <ActionSheet
          open={open}
          onOpenChange={setOpen}
          title="Elegí un estudio"
          subtitle={`${studios.length} estudios`}
        >
          {picker}
        </ActionSheet>
      )}
    </div>
  );
}

function StudioChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 shrink-0 snap-start items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[12px] whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
        active
          ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)] ring-1 ring-inset ring-[var(--color-accent-border)]'
          : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            'text-[10px] tabular-nums',
            active ? 'opacity-70' : 'text-[var(--color-fg-subtle)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function StudioOptionRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left text-[13px] transition-colors',
        active
          ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)]'
          : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
      )}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-fg-subtle)]">
          {count}
        </span>
      )}
    </button>
  );
}
