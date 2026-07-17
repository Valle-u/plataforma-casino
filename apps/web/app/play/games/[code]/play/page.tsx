/**
 * /play/games/[code]/play — Pre-launch del juego (Palace).
 *
 * Sprint 56: removido el mock. Muestra info del juego y un CTA que
 * redirige al iframe de Palace. El loop bet/win lo maneja el provider
 * internamente vía callbacks al backend.
 */

'use client';

import { ArrowLeft, Coins, Dice5, Gauge, Play, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useGameByCode } from '@/lib/hooks/use-games';

const ICONS = {
  slots: Coins,
  crash: TrendingUp,
  table: Dice5,
  live: Gauge,
  mini: Coins,
};

export default function PlayGamePage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const game = useGameByCode(code);

  if (game.isLoading) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10 flex flex-col gap-6">
        <Skeleton className="h-12 w-64 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-[400px] w-full bg-[var(--color-bg-subtle)]" />
      </div>
    );
  }

  if (game.isError || !game.data) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10">
        <EmptyState
          hint="game"
          label="Este juego no está disponible."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/play/lobby">
                <ArrowLeft className="size-3.5" />
                Volver al lobby
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const g = game.data;
  const Icon = ICONS[g.category];

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10 flex flex-col gap-6">
      {/* Breadcrumb back */}
      <Link
        href="/play/lobby"
        className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors self-start"
      >
        <ArrowLeft className="size-3" />
        Lobby
      </Link>

      {/* Header */}
      <header className="flex items-start gap-4">
        <div className="size-14 shrink-0 flex items-center justify-center border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]">
          <Icon className="size-6" />
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-mono">
            {g.category} · {g.providerCode}
          </span>
          <h1 className="font-display text-[2rem] leading-none tracking-tight">
            {g.name}
          </h1>
          {g.shortDescription && (
            <p className="text-[13px] text-[var(--color-fg-muted)] mt-1">
              {g.shortDescription}
            </p>
          )}
        </div>
      </header>

      {/* Sprint 35: CTA real al iframe interactivo. */}
      <div className="relative aspect-video w-full border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] flex flex-col items-center justify-center gap-4 text-center px-6">
        <Icon className="size-16 text-[var(--color-accent-text)]" />
        <div className="flex flex-col gap-2 max-w-md">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
            Listo para jugar
          </span>
          <p className="text-[13px] text-[var(--color-fg)] leading-relaxed">
            Juego real provisto por Palace. Las apuestas se procesan dentro
            del iframe y el resultado se refleja en tu saldo automáticamente.
          </p>
        </div>
        <Link
          href={`/play/games/${g.code}/play/iframe`}
          className="inline-flex items-center gap-2 px-4 h-10 bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)] transition-colors text-[13px]"
        >
          <Play className="size-4" />
          Jugar ahora
        </Link>
      </div>

      {/* Game info / config display */}
      <section className="flex flex-col gap-3 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          Información del juego
        </span>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
          <InfoRow label="Código" value={g.code} mono />
          <InfoRow label="Categoría" value={g.category} />
          <InfoRow label="Provider" value={g.providerCode} mono />
          {Object.entries(g.config).map(([k, v]) => (
            <InfoRow
              key={k}
              label={k}
              value={typeof v === 'string' ? v : JSON.stringify(v)}
              mono
            />
          ))}
        </dl>
      </section>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
        {label}
      </dt>
      <dd
        className={
          mono
            ? 'text-[12px] font-mono text-[var(--color-fg)]'
            : 'text-[12px] text-[var(--color-fg)]'
        }
      >
        {value}
      </dd>
    </div>
  );
}
