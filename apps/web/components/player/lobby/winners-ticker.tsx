'use client';

/**
 * WinnersTicker — barra horizontal de "ganando ahora" para el lobby.
 *
 * Social proof GENERADO (privacy-safe): NO usa datos reales de jugadores. Los
 * ganadores son sintéticos —usernames completos tipo casino + montos altos—,
 * generados en el cliente. Así nunca exponemos el username real de nadie (el
 * feed real anonimiza a "leo***" a propósito) y la barra siempre se ve llena,
 * con montos que llaman la atención (decisión del dueño 2026-08-25).
 *
 * Movimiento:
 *   - Scroll continuo: la lista va DUPLICADA (winners+winners) y el CSS
 *     `animate-winners-marquee` la translada -50% en loop infinito sin saltos.
 *     Esa clase gira SIEMPRE (exenta de prefers-reduced-motion, a propósito:
 *     barra decorativa que el dueño quiere en movimiento constante).
 *   - Se actualiza sola: cada ~30s se regenera la tanda (nuevos usernames +
 *     montos). La animación vive en el contenedor (no se remonta), así el
 *     scroll no se corta al refrescar el contenido.
 *
 * SSR: arranca con una semilla FIJA (misma salida en server y primer render del
 * cliente → sin hydration mismatch); en el cliente se reemplaza al montar.
 */

import { useEffect, useState } from 'react';

interface Winner {
  name: string;
  game: string;
  amount: string;
}

// Handles tipo casino (nicks LatAm plausibles). Se combinan con un sufijo para
// dar variedad y que se lean como usernames reales (completos), no "Nombre I.".
const HANDLES = [
  'elmatador', 'luli', 'tano', 'reydelpampa', 'crackdel10', 'lobo', 'florcita',
  'nachito', 'sabri', 'gordopez', 'lauraok', 'mago', 'panaloco', 'diegote',
  'tincho', 'maru', 'pepe', 'solcito', 'valen', 'ferchu', 'juanma', 'rochi',
  'beto', 'camiok', 'agus', 'naza', 'more', 'tomi', 'brisa', 'ivan',
  'dai', 'leoncito', 'moni', 'richard', 'pili', 'feli', 'guille', 'santi',
  'chino', 'colo', 'flaco', 'negro', 'rulo', 'tato', 'pupi', 'kevin',
];
const SUFFIXES = [
  '', '', '_ok', '.ok', '92', '88', '07', '23', '2005', '10', '_arg', '77',
  '21', '99', '2000', '.mza', '.ba', '_uy', '15', '33', 'x', '_ph',
];
const GAMES = [
  'Golden 7s', 'Pampa Crash', 'Diamante 7', 'Fortuna Gold', 'Río Crash',
  'Neón Royale', 'Mega Bonanza', 'Lucky Spin', 'Aztec Fire', 'Gates of Oro',
  'Sweet Rush', 'Bison Fury', 'Wild Gauchito', 'Crash Rocket', 'Fruit Blast',
  'Dragón Dorado', 'Buffalo King', 'Zeus Power', 'Cleo Riches', 'Joker Stacks',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

// Monto "ganado": realista pero atractivo. La mayoría chicos/medianos y algún
// golazo ocasional que destaca. Enteros exactos (no redondos) para leerse
// creíbles — ej. $23.847, no $25.000.
function randomAmount(): number {
  const r = Math.random();
  let base: number;
  if (r < 0.6) base = 8000 + Math.random() * 30000; // $8k–$38k (lo común)
  else if (r < 0.9) base = 38000 + Math.random() * 60000; // $38k–$98k
  else base = 98000 + Math.random() * 140000; // $98k–$238k (el golazo)
  return Math.round(base);
}

function makeWinners(n: number): Winner[] {
  const out: Winner[] = [];
  const usedNames = new Set<string>();
  let guard = 0;
  while (out.length < n && guard++ < 400) {
    const name = `${pick(HANDLES)}${pick(SUFFIXES)}`;
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

// Semilla FIJA para SSR + primer render del cliente (idéntica en ambos lados).
// Usernames completos y montos altos, igual que la tanda generada.
const SEED_WINNERS: Winner[] = [
  { name: 'elmatador92', game: 'Golden 7s', amount: '$23.847' },
  { name: 'luli_ok', game: 'Pampa Crash', amount: '$14.320' },
  { name: 'reydelpampa', game: 'Gates of Oro', amount: '$112.500' },
  { name: 'nachito07', game: 'Diamante 7', amount: '$31.190' },
  { name: 'crackdel10', game: 'Aztec Fire', amount: '$56.760' },
  { name: 'sabri2005', game: 'Fortuna Gold', amount: '$78.415' },
  { name: 'tano88', game: 'Río Crash', amount: '$19.680' },
  { name: 'florcita.mza', game: 'Neón Royale', amount: '$44.340' },
  { name: 'juanma21', game: 'Mega Bonanza', amount: '$27.500' },
  { name: 'camiok', game: 'Lucky Spin', amount: '$134.900' },
  { name: 'diegote99', game: 'Bison Fury', amount: '$21.310' },
  { name: 'valen_arg', game: 'Wild Gauchito', amount: '$62.070' },
  { name: 'lobo77', game: 'Zeus Power', amount: '$36.250' },
  { name: 'rochi15', game: 'Sweet Rush', amount: '$88.640' },
];

export function WinnersTicker() {
  // Arranca con la semilla (SSR); en el cliente se randomiza al montar y se
  // refresca cada 30s para que la barra "se actualice" sola.
  const [winners, setWinners] = useState<Winner[]>(SEED_WINNERS);
  useEffect(() => {
    setWinners(makeWinners(14));
    const id = setInterval(() => setWinners(makeWinners(14)), 30000);
    return () => clearInterval(id);
  }, []);

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
        <div className="flex w-max items-center gap-8 animate-winners-marquee">
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
