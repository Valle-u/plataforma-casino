/**
 * UserSelect — autocomplete searchable de usuarios del tenant.
 *
 * Diseño:
 *   - Input de search con icon a la izquierda.
 *   - Dropdown absoluto debajo cuando hay focus.
 *   - **Search server-side** vía `?search=` debounced 300ms — escala a
 *     tenants con >500 users sin cargar todos.
 *   - Excluye al actor (`excludeUserId`) — no se puede transferir a sí
 *     mismo (filter client-side post-fetch).
 *   - Solo muestra users con `status='active'` (`?status=active`).
 *   - Click en resultado → onSelect(user) + cierra dropdown.
 *   - Click outside → cierra. Escape cierra.
 *   - Keyboard: ↑↓ navegan, Enter selecciona (sumar cuando emerja necesidad).
 *
 * El componente muestra el user seleccionado en el input cuando hay
 * `value` — el texto del input pasa a "Demo Admin (@demo_admin)".
 */

'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useUsersList, type TenantUserRow } from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';

interface UserSelectProps {
  value: TenantUserRow | null;
  onSelect: (user: TenantUserRow | null) => void;
  /** User que NO debe aparecer en la lista (típicamente el actor). */
  excludeUserId?: string;
  /**
   * Solo mostrar users con este rol (server-side vía `?role=` del
   * listado de users). Ej: 'empleado' para pickear solo empleados.
   */
  filterRoleCode?: string;
  /** Incluir al actor logueado en los resultados (ej: asignar padre = admin). */
  includeSelf?: boolean;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
}

export function UserSelect({
  value,
  onSelect,
  excludeUserId,
  filterRoleCode,
  includeSelf,
  placeholder = 'Buscar usuario por nombre, username o email...',
  invalid,
  disabled,
}: UserSelectProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Server-side fetch — debounce evita request por keystroke. Cap a 50 (default
  // del backend), suficiente para autocomplete; si el operador busca algo más
  // específico debe refinar la query.
  const { data, isLoading, isFetching } = useUsersList({
    search: debouncedQuery,
    status: 'active',
    role: filterRoleCode,
    includeSelf,
    limit: 50,
  });

  // Click fuera cierra dropdown.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Escape cierra.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // El backend ya filtró por search + status='active'. Solo aplicamos el
  // excludeUserId client-side (no hay query param para exclusión por id).
  const matches = useMemo(() => {
    if (!data) return [];
    if (!excludeUserId) return data.data;
    return data.data.filter((u) => u.id !== excludeUserId);
  }, [data, excludeUserId]);

  const totalMatched = data?.total ?? 0;
  const hasMore = totalMatched > matches.length;

  const inputDisplayValue = value
    ? `${value.displayName || value.username} (@${value.username})`
    : query;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={inputDisplayValue}
          readOnly={!!value}
          aria-invalid={invalid}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            // Si el user había seleccionado algo y empieza a tipear, limpio la
            // selección — vuelve a modo búsqueda libre.
            if (value) onSelect(null);
          }}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          className={cn(
            'flex h-9 w-full pl-9 pr-9 py-1.5',
            'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
            'border border-[var(--color-border)]',
            'placeholder:text-[var(--color-fg-subtle)]',
            // Mobile-first: 16px evita el auto-zoom de iOS al enfocar.
            'text-base sm:text-[13px] leading-none',
            'transition-[border-color,box-shadow] duration-150',
            'hover:border-[var(--color-border-strong)]',
            'focus:outline-none focus:border-[var(--color-accent)]',
            'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
            'disabled:cursor-not-allowed disabled:opacity-40',
            'aria-invalid:border-[var(--color-accent)]',
            'aria-invalid:shadow-[0_0_0_3px_var(--color-accent-glow)]',
            value && 'cursor-pointer',
          )}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setQuery('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
            aria-label="Limpiar selección"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && !value && (
        <div
          className={cn(
            'absolute left-0 right-0 top-full mt-1 z-50',
            'bg-[var(--color-bg-elevated)] border border-[var(--color-border-strong)]',
            'max-h-[260px] overflow-y-auto',
            'shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]',
          )}
        >
          {isLoading || (isFetching && matches.length === 0) ? (
            <div className="p-3 text-[12px] text-[var(--color-fg-subtle)]">
              Buscando usuarios…
            </div>
          ) : matches.length === 0 ? (
            <div className="p-3 text-[12px] text-[var(--color-fg-subtle)] italic">
              {debouncedQuery
                ? `Sin coincidencias para "${debouncedQuery}"`
                : 'No hay usuarios disponibles'}
            </div>
          ) : (
            <ul className="flex flex-col">
              {matches.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(u);
                      setQuery('');
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--color-bg-subtle)] border-l-2 border-l-transparent hover:border-l-[var(--color-accent)] transition-colors"
                  >
                    <Avatar name={u.displayName || u.username} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-[var(--color-fg)] truncate">
                        {u.displayName || u.username}
                      </div>
                      <div className="text-[10px] text-[var(--color-fg-subtle)] font-mono truncate">
                        @{u.username}
                        {u.email && ` · ${u.email}`}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
              {hasMore && (
                <li className="px-3 py-2 text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-[0.1em] border-t border-[var(--color-border)]">
                  +{totalMatched - matches.length} más · refiná la búsqueda
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="size-7 shrink-0 border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] flex items-center justify-center text-[10px] font-mono uppercase text-[var(--color-fg-muted)]">
      {initials || '?'}
    </div>
  );
}
