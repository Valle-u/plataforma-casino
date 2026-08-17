'use client';

/**
 * WinnersTicker — barra horizontal de "ganando ahora" para el lobby.
 *
 * Datos REALES: useRecentPublicWins (GET /tenant/games/recent-wins) → últimas
 * jugadas settled con win > 0, usernames anonimizados server-side. Poll 15s.
 *
 * Si todavía no hay jugadas reales (tenant nuevo), cae a una lista demo para
 * que la barra de "social proof" nunca quede vacía.
 *
 * El marquee duplica la lista (winners.concat(winners)) para que el loop de
 * animate-tg-marquee no muestre saltos al reiniciar.
 */

import { useRecentPublicWins } from '@/lib/hooks/use-games';

interface Winner {
  name: string;
  game: string;
  amount: string;
}

const DEMO_WINNERS: Winner[] = [
  { name: 'Mateo S.', game: 'Golden 7s', amount: '$9.120' },
  { name: 'Carla N.', game: 'Pampa Crash', amount: '$22.350' },
  { name: 'Joaquín V.', game: 'Diamante 7', amount: '$18.700' },
  { name: 'Lucía F.', game: 'Fortuna Gold', amount: '$5.480' },
  { name: 'Bruno T.', game: 'Río Crash', amount: '$31.900' },
  { name: 'Valentina R.', game: 'Neón Royale', amount: '$12.640' },
  { name: 'Thiago M.', game: 'Mega Bonanza', amount: '$7.250' },
  { name: 'Sofía G.', game: 'Lucky Spin', amount: '$44.180' },
];

function fmtAmount(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? `$${n.toLocaleString('es-AR')}` : `$${raw}`;
}

export function WinnersTicker() {
  const { data } = useRecentPublicWins(12);

  const real: Winner[] = (data?.data ?? []).map((w) => ({
    name: w.username,
    game: w.gameName,
    amount: fmtAmount(w.amount),
  }));

  // Real si hay jugadas; sino demo (la barra nunca queda vacía).
  const winners = real.length > 0 ? real : DEMO_WINNERS;
  const loop = winners.concat(winners);

  return (
    <div className="flex h-11 w-full items-center overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      {/* Label fijo — no scrollea */}
      <div className="flex shrink-0 items-center gap-2 border-r border-[var(--color-border)] px-4">
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] animate-tg-live"
          style={{ boxShadow: '0 0 8px rgba(57,211,83,.7)' }}
          aria-hidden
        />
        <span className="text-[11px] font-medium uppercase tracking-[.16em] text-[var(--color-fg-muted)]">
          Ganando ahora
        </span>
      </div>

      {/* Marquee */}
      <div className="relative flex-1 overflow-hidden">
        <div className="flex w-max items-center gap-8 animate-tg-marquee">
          {loop.map((w, i) => (
            <span
              key={`${w.name}-${i}`}
              className="flex shrink-0 items-center gap-2 text-[13px] whitespace-nowrap"
            >
              <span className="text-[var(--color-fg)]">{w.name}</span>
              <span className="text-[var(--color-fg-subtle)]">·</span>
              <span className="text-[var(--color-fg-muted)]">{w.game}</span>
              <span className="text-[var(--color-fg-subtle)]">·</span>
              <span className="font-medium tabular-nums text-[var(--color-success)]">
                {w.amount}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
