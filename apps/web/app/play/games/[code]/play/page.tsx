/**
 * /play/games/[code]/play — STUB Sprint 34.
 *
 * Sprint 34: muestra info del game + placeholder "próximamente".
 * Sprint 35: reemplaza placeholder con iframe del mock game (POST
 * launchGame al backend, recibe URL, embed iframe).
 *
 * Para Sprint 34 la página existe solo para que los click en cards del
 * lobby aterricen en algún lado y el jugador vea de qué juego se trata.
 * El loop bet/win NO está implementado todavía.
 */

'use client';

import { ArrowLeft, Construction, Coins, Dice5, Gauge, TrendingUp } from 'lucide-react';
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
        <div className="size-14 shrink-0 flex items-center justify-center border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
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

      {/* Game frame — Sprint 34: placeholder. Sprint 35: <iframe> real. */}
      <div className="relative aspect-video w-full border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] flex flex-col items-center justify-center gap-4 text-center px-6">
        <Construction className="size-12 text-[var(--color-fg-subtle)]" />
        <div className="flex flex-col gap-1 max-w-md">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
            Próximamente jugable
          </span>
          <p className="text-[13px] text-[var(--color-fg)] leading-relaxed">
            El catálogo está armado y vas a poder jugarlo en cuanto el motor
            del juego esté listo (próximo sprint del MVP).
          </p>
          <p className="text-[11px] text-[var(--color-fg-subtle)] mt-2">
            Mientras tanto, podés probar nuestras{' '}
            <Link
              href="/play/wheel"
              className="text-[var(--color-accent)] hover:underline"
            >
              promociones
            </Link>{' '}
            o configurar{' '}
            <Link
              href="/play/settings"
              className="text-[var(--color-accent)] hover:underline"
            >
              tus límites
            </Link>
            .
          </p>
        </div>
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
