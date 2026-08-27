'use client';

import { useEffect, useState } from 'react';
import { Search, Eye, EyeOff, Ban, Star, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { isApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import {
  useAdminGames,
  useUpdateGame,
  useBulkGames,
  type AdminGame,
  type GameCategory,
  type GameStatus,
} from '@/lib/hooks/use-admin-games';

const CATEGORIES: { value: GameCategory | ''; label: string }[] = [
  { value: '', label: 'Todas las categorías' },
  { value: 'slots', label: 'Slots' },
  { value: 'live', label: 'Live' },
  { value: 'crash', label: 'Crash' },
  { value: 'table', label: 'Mesa' },
  { value: 'mini', label: 'Mini' },
];

const STATUSES: { value: GameStatus | ''; label: string }[] = [
  { value: '', label: 'Todos los estados' },
  { value: 'visible', label: 'Visibles' },
  { value: 'hidden', label: 'Ocultos' },
  { value: 'disabled', label: 'Deshabilitados' },
  { value: 'inactive', label: 'Inactivos (sync)' },
];

const PAGE_SIZE = 25;

export function GamesTab() {
  const [search, setSearch] = useState('');
  const debSearch = useDebouncedValue(search, 300);

  // Seed desde el buscador global (⌘K) → /games?tab=games&q=<code>. Client-only.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setSearch(q);
  }, []);
  const [category, setCategory] = useState<GameCategory | ''>('');
  const [status, setStatus] = useState<GameStatus | ''>('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching } = useAdminGames({
    search: debSearch,
    category: category || undefined,
    status: status || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const update = useUpdateGame();
  const bulk = useBulkGames();

  const games = data?.data ?? [];
  const total = data?.total ?? 0;
  const metrics = data?.metrics ?? {};
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const allSelectedOnPage =
    games.length > 0 && games.every((g) => selected.has(g.id));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        games.forEach((g) => next.delete(g.id));
      } else {
        games.forEach((g) => next.add(g.id));
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetFilters = () => {
    setPage(0);
  };

  const patchOne = async (
    g: AdminGame,
    patch: { isHidden?: boolean; isDisabled?: boolean; featured?: boolean },
  ) => {
    try {
      await update.mutateAsync({ id: g.id, patch });
    } catch (err) {
      toast.error('No se pudo actualizar', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    }
  };

  const runBulk = async (patch: {
    isHidden?: boolean;
    isDisabled?: boolean;
    featured?: boolean;
  }) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      const res = await bulk.mutateAsync({ ids, ...patch });
      toast.success(`${res.affected} juego(s) actualizados`);
      setSelected(new Set());
    } catch (err) {
      toast.error('No se pudo aplicar en lote', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    }
  };

  const selCount = selected.size;

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-0 sm:min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetFilters();
            }}
            placeholder="Buscar por nombre o código…"
            className="w-full h-9 pl-9 pr-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[13px] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as GameCategory | '');
            resetFilters();
          }}
          className={selectCls}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as GameStatus | '');
            resetFilters();
          }}
          className={selectCls}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Barra de acciones masivas */}
      {selCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-accent-subtle)] border border-[var(--color-accent-border)] px-3 py-2">
          <span className="text-[12px] font-medium text-[var(--color-accent-text)]">
            {selCount} seleccionado{selCount > 1 ? 's' : ''}
          </span>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            <BulkBtn onClick={() => void runBulk({ isHidden: true })} disabled={bulk.isPending}>
              <EyeOff className="size-3.5" /> Ocultar
            </BulkBtn>
            <BulkBtn onClick={() => void runBulk({ isHidden: false })} disabled={bulk.isPending}>
              <Eye className="size-3.5" /> Mostrar
            </BulkBtn>
            <BulkBtn onClick={() => void runBulk({ isDisabled: true })} disabled={bulk.isPending}>
              <Ban className="size-3.5" /> Deshabilitar
            </BulkBtn>
            <BulkBtn onClick={() => void runBulk({ isDisabled: false })} disabled={bulk.isPending}>
              Habilitar
            </BulkBtn>
            <BulkBtn onClick={() => void runBulk({ featured: true })} disabled={bulk.isPending}>
              <Star className="size-3.5" /> Destacar
            </BulkBtn>
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
              <th className="w-8 p-2.5">
                <input
                  type="checkbox"
                  checked={allSelectedOnPage}
                  onChange={toggleSelectAll}
                  aria-label="Seleccionar todos"
                />
              </th>
              <Th>Juego</Th>
              <Th>Categoría</Th>
              <Th>Estado</Th>
              <Th className="text-right">Rounds</Th>
              <Th className="text-right">GGR</Th>
              <Th>Última jugada</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-[var(--color-fg-muted)]">
                  <Loader2 className="size-5 animate-spin inline" />
                </td>
              </tr>
            ) : games.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-[13px] text-[var(--color-fg-muted)]">
                  No hay juegos que coincidan. Sincronizá el catálogo desde la tab Proveedores.
                </td>
              </tr>
            ) : (
              games.map((g) => {
                const m = metrics[g.id];
                return (
                  <tr
                    key={g.id}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-subtle)]"
                  >
                    <td className="p-2.5 align-middle">
                      <input
                        type="checkbox"
                        checked={selected.has(g.id)}
                        onChange={() => toggleSelect(g.id)}
                        aria-label={`Seleccionar ${g.name}`}
                      />
                    </td>
                    <td className="p-2.5 align-middle">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {g.thumbnailUrl ? (
                          <img
                            src={g.thumbnailUrl}
                            alt=""
                            className="size-9 object-cover rounded border border-[var(--color-border)] shrink-0"
                          />
                        ) : (
                          <div className="size-9 rounded bg-[var(--color-bg-subtle)] border border-[var(--color-border)] shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium truncate flex items-center gap-1">
                            {g.featured && (
                              <Star className="size-3 shrink-0 fill-current text-[var(--color-accent-text)]" />
                            )}
                            {g.name}
                          </span>
                          <span className="text-[11px] font-mono text-[var(--color-fg-subtle)] truncate">
                            {g.code}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="p-2.5 align-middle capitalize text-[var(--color-fg-muted)]">
                      {g.category}
                    </td>
                    <td className="p-2.5 align-middle">
                      <GameStatusBadges game={g} />
                    </td>
                    <td className="p-2.5 align-middle text-right tabular-nums text-[var(--color-fg-muted)]">
                      {m?.rounds ?? 0}
                    </td>
                    <td className="p-2.5 align-middle text-right tabular-nums text-[var(--color-fg-muted)]">
                      {m ? formatGgr(m.ggr) : '0'}
                    </td>
                    <td className="p-2.5 align-middle text-[11px] text-[var(--color-fg-muted)]">
                      {m?.lastPlayedAt
                        ? new Date(m.lastPlayedAt).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
                        : 'Nunca'}
                    </td>
                    <td className="p-2.5 align-middle">
                      <div className="flex items-center justify-end gap-1">
                        <IconToggle
                          active={g.isHidden}
                          title={g.isHidden ? 'Mostrar en lobby' : 'Ocultar del lobby'}
                          onClick={() => void patchOne(g, { isHidden: !g.isHidden })}
                        >
                          {g.isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </IconToggle>
                        <IconToggle
                          active={g.isDisabled}
                          danger
                          title={g.isDisabled ? 'Habilitar' : 'Deshabilitar'}
                          onClick={() => void patchOne(g, { isDisabled: !g.isDisabled })}
                        >
                          <Ban className="size-4" />
                        </IconToggle>
                        <IconToggle
                          active={g.featured}
                          title={g.featured ? 'Quitar destacado' : 'Destacar'}
                          onClick={() => void patchOne(g, { featured: !g.featured })}
                        >
                          <Star className={g.featured ? 'size-4 fill-current' : 'size-4'} />
                        </IconToggle>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between text-[12px] text-[var(--color-fg-muted)]">
        <span>
          {total} juego{total !== 1 ? 's' : ''}
          {isFetching && !isLoading ? ' · actualizando…' : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 rounded-md border border-[var(--color-border)] disabled:opacity-40"
          >
            Anterior
          </button>
          <span>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
            disabled={page + 1 >= totalPages}
            className="px-3 py-1 rounded-md border border-[var(--color-border)] disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}

const selectCls =
  'h-9 px-2 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[13px] text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-accent)]';

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`p-2.5 text-left text-[11px] uppercase tracking-[0.06em] font-medium text-[var(--color-fg-muted)] ${className}`}
    >
      {children}
    </th>
  );
}

function GameStatusBadges({ game }: { game: AdminGame }) {
  const badges: { label: string; tone: 'ok' | 'warn' | 'error' | 'neutral' }[] = [];
  if (!game.isActive) badges.push({ label: 'Inactivo', tone: 'neutral' });
  if (game.isDisabled) badges.push({ label: 'Deshabilitado', tone: 'error' });
  if (game.isHidden) badges.push({ label: 'Oculto', tone: 'warn' });
  if (badges.length === 0) badges.push({ label: 'Visible', tone: 'ok' });

  const color = (tone: string) =>
    tone === 'ok'
      ? { c: 'var(--color-success, #22c55e)' }
      : tone === 'warn'
        ? { c: '#eab308' }
        : tone === 'error'
          ? { c: '#ef4444' }
          : { c: 'var(--color-fg-muted)' };

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <span
          key={b.label}
          className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium border"
          style={{ color: color(b.tone).c, borderColor: color(b.tone).c }}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

function IconToggle({
  active,
  danger,
  title,
  onClick,
  children,
}: {
  active: boolean;
  danger?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex size-7 items-center justify-center rounded transition-colors hover:bg-[var(--color-bg-elevated)]"
      style={{
        color: active
          ? danger
            ? '#ef4444'
            : 'var(--color-accent-text)'
          : 'var(--color-fg-subtle)',
      }}
    >
      {children}
    </button>
  );
}

function BulkBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 text-[12px] font-medium transition-colors hover:border-[var(--color-fg-muted)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function formatGgr(ggr: string): string {
  const n = Number(ggr);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
