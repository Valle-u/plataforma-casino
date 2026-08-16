/**
 * Presentación compartida de usuarios — tabla desktop + cards mobile.
 *
 * Helpers de formato y componentes de UI que /users (y la card list
 * mobile) reutilizan para mantener idéntica la representación de rol,
 * estado, avatar y fechas en ambos viewports.
 */

'use client';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export const ROLE_VARIANT: Record<string, BadgeVariant> = {
  admin_tenant: 'danger',
  socio: 'warning',
  distribuidor: 'info',
  cajero: 'info',
  empleado: 'neutral',
  usuario_final: 'neutral',
};

export const ROLE_SHORT_LABEL: Record<string, string> = {
  admin_tenant: 'Admin',
  socio: 'Socio',
  distribuidor: 'Distrib.',
  cajero: 'Cajero',
  empleado: 'Empleado',
  usuario_final: 'Jugador',
};

const STATUS_TEXT: Record<string, string> = {
  active: 'Activo',
  banned: 'Bloqueado',
  suspended: 'Suspendido',
  pending: 'Pendiente',
  inactive: 'Inactivo',
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  banned: 'danger',
  suspended: 'warning',
  pending: 'neutral',
  inactive: 'warning',
};

/** Estado del usuario como badge (Activo / Bloqueado / …). */
export function StatusDot({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'neutral'}>
      {STATUS_TEXT[status] ?? status}
    </Badge>
  );
}

// Paleta de avatares — círculo de color según el nombre (como en la referencia).
const AVATAR_COLORS = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
  'bg-indigo-600',
  'bg-teal-600',
  'bg-fuchsia-600',
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

export function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold uppercase shrink-0 text-white',
        avatarColor(name),
        size === 'sm' && 'size-8 text-[12px]',
        size === 'md' && 'size-9 text-[13px]',
        size === 'lg' && 'size-11 text-[15px]',
      )}
    >
      {initials || '?'}
    </div>
  );
}

export function RolesChips({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return <span className="text-[11px] text-[var(--color-fg-subtle)] italic">sin rol</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {codes.map((c) => (
        <Badge
          key={c}
          variant={ROLE_VARIANT[c] ?? 'neutral'}
          className="text-[10px] uppercase tracking-[0.04em]"
        >
          {ROLE_SHORT_LABEL[c] ?? c}
        </Badge>
      ))}
    </div>
  );
}

export function formatFull(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `hace ${hr}h`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `hace ${days}d`;
    const months = Math.floor(days / 30);
    if (months < 12) return `hace ${months}mes`;
    const years = Math.floor(days / 365);
    return `hace ${years}a`;
  } catch {
    return iso;
  }
}
