/**
 * /play/bonuses — Mis bonos (rediseño "Neón Milonga", Casino TANGO).
 *
 * Pantalla "Bonos" del handoff. El chrome lo provee play/layout.tsx.
 *
 * Composición:
 *   - Header: kicker + título + Refrescar.
 *   - Tabs: Activos / Liberados / Historial (con conteo).
 *   - Grid de cards: icono + título + tipo + valor (CHIPS) + barra de
 *     progreso + vencimiento + CTA "Jugar ahora".
 *
 * Función PRESERVADA:
 *   - useMyBonuses (GET /tenant/bonuses/me) → BonusRow[] con monto/estado/fechas.
 *   - Filtro por estado (ahora client-side para tener conteos en cada tab).
 *   - Refrescar + estados loading/error/empty.
 */

'use client';

import { Gift, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMyBonuses,
  type BonusRow,
  type BonusStatus,
} from '@/lib/hooks/use-bonuses';
import { cn } from '@/lib/cn';

const STATUS_META: Record<BonusStatus, { tone: string; label: string }> = {
  active: { tone: 'var(--color-success)', label: 'Activo' },
  pending: { tone: 'var(--color-gold)', label: 'Pendiente' },
  cleared: { tone: 'var(--color-accent-text)', label: 'Liberado' },
  force_cleared: { tone: 'var(--color-accent-text)', label: 'Liberado' },
  cancelled: { tone: 'var(--color-fg-subtle)', label: 'Cancelado' },
  expired: { tone: 'var(--color-fg-subtle)', label: 'Expirado' },
};

const TYPE_LABEL: Record<string, string> = {
  deposit_match: 'Bono por depósito',
  free_spins: 'Giros gratis',
  cashback: 'Cashback',
  welcome: 'Paquete de bienvenida',
  reload: 'Recarga',
  no_deposit: 'Sin depósito',
};

function typeLabel(t: string | null | undefined): string {
  if (!t) return 'Bono';
  return TYPE_LABEL[t] ?? t.replace(/_/g, ' ');
}

/** Colores rotativos para el icono de cada card. */
const TONES = [
  'var(--color-magenta)',
  'var(--color-accent)',
  'var(--color-success)',
  'var(--color-gold)',
  'var(--color-purple)',
];

type Group = 'active' | 'cleared' | 'all';

const GROUP_TABS: { id: Group; label: string }[] = [
  { id: 'active', label: 'Activos' },
  { id: 'cleared', label: 'Liberados' },
  { id: 'all', label: 'Historial' },
];

function inGroup(status: BonusStatus, group: Group): boolean {
  if (group === 'all') return true;
  if (group === 'active') return status === 'active' || status === 'pending';
  if (group === 'cleared')
    return status === 'cleared' || status === 'force_cleared';
  return true;
}

export default function PlayBonusesPage() {
  const [group, setGroup] = useState<Group>('active');

  // Traemos todos los bonos una vez (los jugadores tienen pocos) y
  // filtramos client-side → conteos en cada tab + cambio de tab instantáneo.
  const { data, isLoading, isError, refetch, isFetching } = useMyBonuses({
    limit: 100,
    offset: 0,
  });

  const rows = useMemo(() => data?.data ?? [], [data]);

  const counts = useMemo(
    () => ({
      active: rows.filter((b) => inGroup(b.status, 'active')).length,
      cleared: rows.filter((b) => inGroup(b.status, 'cleared')).length,
      all: rows.length,
    }),
    [rows],
  );

  const filtered = useMemo(
    () => rows.filter((b) => inGroup(b.status, group)),
    [rows, group],
  );

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
            <Gift className="size-3" />
            Tus bonos
          </span>
          <h1 className="font-display text-[34px] leading-none">Mis bonos</h1>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={() => refetch()}
          disabled={isFetching}
          className="shrink-0"
        >
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
          <span className="hidden sm:inline">Refrescar</span>
        </Button>
      </header>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {GROUP_TABS.map((t) => {
          const active = group === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setGroup(t.id)}
              aria-pressed={active}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors',
                active
                  ? 'text-[var(--color-accent-fg)]'
                  : 'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]',
              )}
              style={active ? { background: 'var(--gradient-accent)' } : undefined}
            >
              {t.label}
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  active ? 'opacity-80' : 'text-[var(--color-fg-subtle)]',
                )}
              >
                {counts[t.id]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-52 w-full rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)]"
            />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          hint="my_bonuses"
          label="No se pudieron cargar tus bonos."
          action={
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          hint="my_bonuses"
          label={
            group === 'active'
              ? 'No tenés bonos activos en este momento'
              : 'Sin bonos en este filtro'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((bonus, i) => (
            <BonusCard key={bonus.id} bonus={bonus} tone={TONES[i % TONES.length]!} />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// BonusCard
// ──────────────────────────────────────────────────────────────────────

function BonusCard({ bonus, tone }: { bonus: BonusRow; tone: string }) {
  const granted = Number(bonus.grantedAmount);
  const remaining = Number(bonus.remainingAmount);
  // Progreso de liberación: cuánto ya se liberó del total otorgado.
  const cleared =
    bonus.status === 'cleared' || bonus.status === 'force_cleared';
  const progress = cleared
    ? 100
    : granted > 0
      ? Math.max(0, Math.min(100, ((granted - remaining) / granted) * 100))
      : 0;
  const meta = STATUS_META[bonus.status];
  const isActive = bonus.status === 'active' || bonus.status === 'pending';
  const dim = bonus.status === 'expired' || bonus.status === 'cancelled';

  return (
    <article
      className={cn(
        'flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 transition-colors',
        isActive && 'hover:border-[var(--color-accent-border)]',
        dim && 'opacity-65',
      )}
      style={{
        backgroundImage: `radial-gradient(120% 80% at 100% 0%, color-mix(in srgb, ${tone} 12%, transparent) 0%, transparent 55%)`,
      }}
    >
      {/* Top: icono + nombre/tipo + estado */}
      <div className="flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[var(--radius)]"
          style={{
            background: `color-mix(in srgb, ${tone} 22%, transparent)`,
            color: tone,
            boxShadow: `0 0 14px -4px ${tone}`,
          }}
          aria-hidden
        >
          <Gift className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-display truncate text-[16px] leading-tight text-[var(--color-fg)]">
            {bonus.definitionName ?? typeLabel(bonus.definitionType)}
          </span>
          <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
            {typeLabel(bonus.definitionType)}
          </span>
        </div>
        <span
          className="shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
          style={{
            color: meta.tone,
            background: `color-mix(in srgb, ${meta.tone} 16%, transparent)`,
          }}
        >
          {meta.label}
        </span>
      </div>

      {/* Valor */}
      <div className="flex items-baseline gap-2">
        <span
          className="font-display tabular-nums leading-none"
          style={{ fontSize: '2rem', color: tone }}
        >
          {remaining.toLocaleString('es-AR')}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          Fichas
        </span>
      </div>

      {/* Progreso */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[var(--color-fg-muted)]">Progreso</span>
          <span className="tabular-nums text-[var(--color-fg-subtle)]">
            {Math.round(progress)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg)]">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress}%`,
              background: cleared ? 'var(--color-success)' : tone,
              boxShadow: `0 0 8px -2px ${cleared ? 'var(--color-success)' : tone}`,
            }}
          />
        </div>
      </div>

      {/* Footer: vencimiento + CTA */}
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          {expiryLabel(bonus)}
        </span>
        {isActive && (
          <Link
            href="/play/lobby"
            className="inline-flex h-8 items-center rounded-[var(--radius-sm)] px-3 text-[12px] font-semibold text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            Jugar ahora
          </Link>
        )}
      </div>
    </article>
  );
}

function expiryLabel(bonus: BonusRow): string {
  if (bonus.status === 'cleared' || bonus.status === 'force_cleared')
    return 'Liberado';
  if (bonus.status === 'expired') return 'Expirado';
  if (bonus.status === 'cancelled') return 'Cancelado';
  if (!bonus.expiresAt) return 'Sin vencimiento';
  try {
    const ms = new Date(bonus.expiresAt).getTime() - new Date().getTime();
    const days = Math.ceil(ms / 86_400_000);
    if (days <= 0) return 'Vence hoy';
    return `Vence en ${days} ${days === 1 ? 'día' : 'días'}`;
  } catch {
    return '';
  }
}
