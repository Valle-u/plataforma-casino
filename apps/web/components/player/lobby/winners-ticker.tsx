'use client';

/**
 * WinnersTicker — barra horizontal de "ganando ahora" para el lobby.
 *
 * Datos REALES: useRecentPublicWins (GET /tenant/games/recent-wins) → últimas
 * jugadas settled con win > 0, usernames anonimizados server-side. Poll 15s.
 *
 * Si todavía no hay jugadas reales (tenant nuevo), cae a una lista demo para
 * que la barra de "social proof" nunca quede vacía. La demo se genera con
 * nombres aleatorios y montos razonables (`makeDemoWinners`): así no se repite
 * siempre la misma gente ni montos exagerados. Se randomiza en el cliente al
 * montar (arranca con una semilla fija para no romper la hidratación SSR).
 *
 * El marquee duplica la lista (winners.concat(winners)) para que el loop de
 * animate-tg-marquee no muestre saltos al reiniciar.
 */

import { useEffect, useState } from 'react';
import { useRecentPublicWins } from '@/lib/hooks/use-games';

interface Winner {
  name: string;
  game: string;
  amount: string;
}

// Pools para la demo aleatoria (nombres LatAm mixtos + juegos plausibles).
const FIRST_NAMES = [
  'Mateo', 'Valentina', 'Joaquín', 'Sofía', 'Bruno', 'Lucía', 'Thiago',
  'Camila', 'Benjamín', 'Martina', 'Lautaro', 'Julieta', 'Santino',
  'Catalina', 'Facundo', 'Renata', 'Gael', 'Emma', 'Bautista', 'Delfina',
  'Tomás', 'Mía', 'Ignacio', 'Isabella', 'Nicolás', 'Victoria', 'Agustín',
  'Guadalupe', 'Lucas', 'Pilar', 'Franco', 'Josefina', 'Ramiro', 'Abril',
  'Dante', 'Morena',
];
const INITIALS = 'ABCDEFGHIJLMNOPRSTV'.split('');
const GAMES = [
  'Golden 7s', 'Pampa Crash', 'Diamante 7', 'Fortuna Gold', 'Río Crash',
  'Neón Royale', 'Mega Bonanza', 'Lucky Spin', 'Aztec Fire', 'Gates of Oro',
  'Sweet Rush', 'Bison Fury', 'Wild Gauchito', 'Crash Rocket', 'Fruit Blast',
  'Dragón Dorado', 'Buffalo King', 'Zeus Power', 'Cleo Riches', 'Joker Stacks',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

// Monto "ganado" razonable: mayoría chicos, algunos medianos y pocos grandes.
// Tope ~$45k para no exagerar. Redondeo a $10 para que se lea natural.
function randomAmount(): number {
  const r = Math.random();
  let base: number;
  if (r < 0.68) base = 1000 + Math.random() * 11000; // $1k–$12k (lo común)
  else if (r < 0.94) base = 12000 + Math.random() * 16000; // $12k–$28k
  else base = 28000 + Math.random() * 17000; // $28k–$45k (poco frecuente)
  return Math.round(base / 10) * 10;
}

function makeDemoWinners(n: number): Winner[] {
  const out: Winner[] = [];
  const usedNames = new Set<string>();
  let guard = 0;
  while (out.length < n && guard++ < 200) {
    const name = `${pick(FIRST_NAMES)} ${pick(INITIALS)}.`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    out.push({
      name,
      game: pick(GAMES),
      amount: `$${randomAmount().toLocaleString('es-AR')}`,
    });
  }
  return out;
}

// Semilla fija para SSR + primer render del cliente (misma salida en ambos →
// sin hydration mismatch). En el cliente se reemplaza por una tanda aleatoria.
const SEED_WINNERS: Winner[] = [
  { name: 'Mateo S.', game: 'Golden 7s', amount: '$9.120' },
  { name: 'Carla N.', game: 'Pampa Crash', amount: '$14.350' },
  { name: 'Joaquín V.', game: 'Diamante 7', amount: '$6.700' },
  { name: 'Lucía F.', game: 'Fortuna Gold', amount: '$5.480' },
  { name: 'Bruno T.', game: 'Río Crash', amount: '$21.900' },
  { name: 'Valentina R.', game: 'Neón Royale', amount: '$12.640' },
  { name: 'Thiago M.', game: 'Mega Bonanza', amount: '$7.250' },
  { name: 'Sofía G.', game: 'Lucky Spin', amount: '$18.180' },
  { name: 'Franco D.', game: 'Aztec Fire', amount: '$3.960' },
  { name: 'Renata B.', game: 'Gates of Oro', amount: '$27.400' },
];

function fmtAmount(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? `$${n.toLocaleString('es-AR')}` : `$${raw}`;
}

export function WinnersTicker() {
  const { data } = useRecentPublicWins(12);

  // Demo aleatoria: arranca con la semilla (para SSR) y se randomiza al montar.
  const [demo, setDemo] = useState<Winner[]>(SEED_WINNERS);
  useEffect(() => {
    setDemo(makeDemoWinners(10));
  }, []);

  const real: Winner[] = (data?.data ?? []).map((w) => ({
    name: w.username,
    game: w.gameName,
    amount: fmtAmount(w.amount),
  }));

  // Real si hay jugadas; sino demo (la barra nunca queda vacía).
  const winners = real.length > 0 ? real : demo;
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
