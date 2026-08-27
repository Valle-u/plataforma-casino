/**
 * CommandPalette — buscador global del panel (⌘K / Ctrl+K).
 *
 * Busca en TODO lo buscable del panel, respetando permisos:
 *   - Páginas: navegación instantánea (source-of-truth `visibleSectionsFor`,
 *     ya filtrado por permisos). Con query vacío lista las páginas visibles.
 *   - Usuarios: `GET /tenant/users?search=` (gated por `users.view_any`).
 *   - Juegos: `GET /tenant/games/active?search=` (gated por rol admin_tenant).
 *   - Transferencias: `GET /tenant/bank-transactions?search=` (gated por `bank_tx.view`).
 *
 * Los resultados de backend solo se piden con ≥2 caracteres (debounce 250ms) y
 * solo para las fuentes que el usuario puede ver (el `enabled` de cada hook).
 * Navegación por teclado: ↑/↓ mueve, Enter abre, Esc cierra.
 */

'use client';

import {
  ArrowRight,
  CornerDownLeft,
  Dices,
  Landmark,
  Search,
  User as UserIcon,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hasPermission, isAdminTenant, useAuth } from '@/lib/auth-context';
import { useUsersList } from '@/lib/hooks/use-users';
import { useActiveGames } from '@/lib/hooks/use-games';
import { useBankTransactions } from '@/lib/hooks/use-bank-transactions';
import { visibleSectionsFor } from '@/components/admin/sidebar';
import { providerLabel } from '@/lib/provider-label';
import { cn } from '@/lib/cn';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Result {
  key: string;
  group: string;
  label: string;
  sub?: string;
  href: string;
  icon: Icon;
}

const MIN_QUERY = 2;
const PER_SOURCE = 6;

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset al abrir + foco.
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setSelected(0);
      // Foco tras el paint (el input recién existe cuando open=true).
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Debounce de la query para las fuentes de backend.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Permisos por fuente.
  const canUsers = hasPermission(user, 'users.view_any');
  const canGames = isAdminTenant(user);
  const canBankTx = hasPermission(user, 'bank_tx.view');
  const backendReady = open && debounced.length >= MIN_QUERY;

  const usersQ = useUsersList(
    { search: debounced, limit: PER_SOURCE },
    { enabled: backendReady && canUsers },
  );
  const gamesQ = useActiveGames(
    { search: debounced, limit: PER_SOURCE },
    { enabled: backendReady && canGames },
  );
  const bankQ = useBankTransactions(
    { search: debounced, limit: PER_SOURCE },
    { enabled: backendReady && canBankTx },
  );

  // Páginas: instantáneo, client-side. Con query vacío lista todas las visibles.
  const pageResults = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Result[] = [];
    for (const section of visibleSectionsFor(user)) {
      for (const item of section.items) {
        const hay = `${section.title} ${item.label}`.toLowerCase();
        if (q === '' || hay.includes(q)) {
          out.push({
            key: `page:${item.href}`,
            group: 'Páginas',
            label: item.label,
            sub: section.title,
            href: item.href,
            icon: item.icon,
          });
        }
      }
    }
    return out.slice(0, q === '' ? 12 : 8);
  }, [query, user]);

  const userResults = useMemo<Result[]>(() => {
    if (!usersQ.data) return [];
    return usersQ.data.data.map((u) => ({
      key: `user:${u.id}`,
      group: 'Usuarios',
      label: u.displayName || u.username,
      sub: `@${u.username}${u.email ? ` · ${u.email}` : ''}`,
      href: `/users/${u.id}`,
      icon: UserIcon,
    }));
  }, [usersQ.data]);

  const gameResults = useMemo<Result[]>(() => {
    if (!gamesQ.data) return [];
    return gamesQ.data.data.map((g) => ({
      key: `game:${g.id}`,
      group: 'Juegos',
      label: g.name,
      sub: `${providerLabel(g.providerCode)} · ${g.code}`,
      href: `/games?tab=games&q=${encodeURIComponent(g.code)}`,
      icon: Dices,
    }));
  }, [gamesQ.data]);

  const bankResults = useMemo<Result[]>(() => {
    if (!bankQ.data) return [];
    return bankQ.data.data.map((t) => ({
      key: `banktx:${t.id}`,
      group: 'Transferencias',
      label: t.senderName || '(sin remitente)',
      sub: `$${Number(t.amount).toLocaleString('es-AR')}${t.reference ? ` · ${t.reference}` : ''}`,
      href: `/bank-transactions?q=${encodeURIComponent(t.senderName ?? '')}`,
      icon: Landmark,
    }));
  }, [bankQ.data]);

  // Lista plana (para navegación por teclado) + agrupada (para render).
  const flat = useMemo<Result[]>(
    () => [...pageResults, ...userResults, ...gameResults, ...bankResults],
    [pageResults, userResults, gameResults, bankResults],
  );

  const groups = useMemo(() => {
    const order = ['Páginas', 'Usuarios', 'Juegos', 'Transferencias'];
    const map = new Map<string, Result[]>();
    for (const r of flat) {
      const arr = map.get(r.group) ?? [];
      arr.push(r);
      map.set(r.group, arr);
    }
    return order.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
  }, [flat]);

  // Clamp de la selección cuando cambian los resultados.
  useEffect(() => {
    setSelected((s) => (flat.length === 0 ? 0 : Math.min(s, flat.length - 1)));
  }, [flat.length]);

  // Scroll del item seleccionado a la vista.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    onClose();
    router.push(r.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (flat.length ? (s + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (flat.length ? (s - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(flat[selected]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  const loading =
    (backendReady && canUsers && usersQ.isLoading) ||
    (backendReady && canGames && gamesQ.isLoading) ||
    (backendReady && canBankTx && bankQ.isLoading);
  const tooShort = query.trim().length > 0 && query.trim().length < MIN_QUERY;

  // Índice global por item (para keyboard + data-idx). Se calcula al vuelo.
  let runningIdx = -1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Búsqueda global"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Cerrar búsqueda"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-[560px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl"
        onKeyDown={onKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
          <Search className="size-4 shrink-0 text-[var(--color-fg-subtle)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar páginas, usuarios, juegos, transferencias…"
            aria-label="Buscar en el panel"
            className="h-12 w-full bg-transparent text-[15px] text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)]"
          />
          {loading && (
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
          )}
        </div>

        {/* Resultados */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {groups.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--color-fg-muted)]">
              {tooShort
                ? 'Escribí al menos 2 caracteres…'
                : query.trim()
                  ? `Sin resultados para "${query.trim()}".`
                  : 'Escribí para buscar en todo el panel.'}
            </p>
          ) : (
            groups.map((grp) => (
              <div key={grp.group} className="mb-1">
                <p className="px-4 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                  {grp.group}
                </p>
                {grp.items.map((r) => {
                  runningIdx += 1;
                  const idx = runningIdx;
                  const active = idx === selected;
                  const RIcon = r.icon;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      data-idx={idx}
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => go(r)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left',
                        active ? 'bg-[var(--color-accent-subtle)]' : 'hover:bg-[var(--color-bg-subtle)]',
                      )}
                    >
                      <RIcon
                        className={cn(
                          'size-4 shrink-0',
                          active ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg-subtle)]',
                        )}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] text-[var(--color-fg)]">{r.label}</span>
                        {r.sub && (
                          <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">{r.sub}</span>
                        )}
                      </span>
                      {active && <CornerDownLeft className="size-3.5 shrink-0 text-[var(--color-fg-subtle)]" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer con hints */}
        <div className="flex items-center gap-4 border-t border-[var(--color-border)] px-4 py-2 text-[10px] text-[var(--color-fg-subtle)]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--color-border)] px-1">↑</kbd>
            <kbd className="rounded border border-[var(--color-border)] px-1">↓</kbd>
            navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--color-border)] px-1">↵</kbd>
            abrir
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--color-border)] px-1">esc</kbd>
            cerrar
          </span>
          <span className="ml-auto flex items-center gap-1">
            <ArrowRight className="size-3" /> {flat.length} resultado{flat.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}
