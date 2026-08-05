/**
 * UserCardList — lista de usuarios mobile-first (Sprint 55.x).
 *
 * Reemplaza a la tabla densa en viewports < lg. Cada usuario es una
 * tarjeta apilada con:
 *   - Avatar + nombre + @username (tap → /users/:id) + estado.
 *   - Roles chips + balance wallet + bono.
 *   - Último login relativo.
 *   - Botón "Ver perfil" full-width + action sheet con todas las
 *     acciones del usuario (tap targets >= 44px).
 *
 * Desktop NO cambia: la tabla sigue en <lg>.
 */

'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { UserActionsCell } from '@/components/admin/user-actions-cell';
import {
  Avatar,
  RolesChips,
  StatusDot,
  formatRelative,
} from '@/components/admin/user-presentation';
import type { TenantUserRow } from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';

interface UserCardListProps {
  rows: TenantUserRow[];
  onSuccess?: () => void;
}

export function UserCardList({ rows, onSuccess }: UserCardListProps) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((u) => (
        <UserCard key={u.id} user={u} onSuccess={onSuccess} />
      ))}
    </div>
  );
}

function UserCard({ user, onSuccess }: { user: TenantUserRow; onSuccess?: () => void }) {
  const isPlayer = user.roleCodes.includes('usuario_final');

  return (
    <article className="flex flex-col gap-3 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      {/* Header: avatar + nombre + estado */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/users/${user.id}`}
          className="flex items-center gap-3 min-w-0 flex-1"
        >
          <Avatar name={user.displayName || user.username} size="lg" />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[14px] font-medium text-[var(--color-fg)] truncate">
              {user.displayName || user.username}
            </span>
            <span className="text-[11px] font-mono text-[var(--color-fg-subtle)] truncate">
              @{user.username}
            </span>
          </div>
        </Link>
        <StatusDot status={user.status} />
      </div>

      <RolesChips codes={user.roleCodes} />

      {/* Balances */}
      <div className="grid grid-cols-2 gap-2">
        <div className="px-3 py-2.5 bg-[var(--color-bg-subtle)] border border-[var(--color-border)]">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
            Wallet
          </div>
          <div className="font-display text-2xl tabular-nums tracking-tight text-[var(--color-fg)] mt-0.5">
            {user.walletBalance === null
              ? '—'
              : Number(user.walletBalance).toLocaleString()}
          </div>
        </div>
        <div className="px-3 py-2.5 bg-[var(--color-bg-subtle)] border border-[var(--color-border)]">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
            Bono
          </div>
          <div
            className={cn(
              'font-display text-2xl tabular-nums tracking-tight mt-0.5',
              !isPlayer || user.bonusBalance === null
                ? 'text-[var(--color-fg-subtle)]'
                : 'text-[var(--color-gold)]',
            )}
          >
            {!isPlayer || user.bonusBalance === null
              ? '—'
              : Number(user.bonusBalance).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Último login */}
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] shrink-0">
          Último login
        </span>
        {user.lastLoginAt ? (
          <span className="font-mono tabular-nums text-[var(--color-fg-muted)]">
            {formatRelative(user.lastLoginAt)}
          </span>
        ) : (
          <span className="text-[var(--color-fg-subtle)] italic">nunca</span>
        )}
      </div>

      {/* Acciones */}
      <div className="flex flex-col gap-2">
        <Link
          href={`/users/${user.id}`}
          className="h-12 flex items-center justify-center gap-1.5 text-[12px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
        >
          Ver perfil
          <ChevronRight className="size-3.5" />
        </Link>
        <UserActionsCell user={user} onSuccess={onSuccess} variant="sheet" />
      </div>
    </article>
  );
}
