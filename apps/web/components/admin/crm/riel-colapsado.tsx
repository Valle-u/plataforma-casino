/**
 * Lo que queda de una columna cuando se la colapsa: un riel de 46px.
 *
 * No desaparece del todo a propósito. Una columna que se esfuma no deja pista
 * de cómo traerla de vuelta, y el operador termina recargando la página. El
 * riel es esa pista: el nombre de la columna escrito en vertical y, si aplica,
 * cuántas cosas tiene adentro.
 *
 * El contador importa más de lo que parece: con la lista colapsada, es lo único
 * que dice que entraron conversaciones nuevas.
 */

'use client';

import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { RIEL } from '@/lib/crm/layout-bandeja';

export function RielColapsado({
  titulo,
  contador,
  onAbrir,
  lado,
}: {
  titulo: string;
  /** `null` si esta columna no tiene nada que contar. */
  contador: number | null;
  onAbrir: () => void;
  /** De qué lado de la pantalla está, para que la flecha apunte bien. */
  lado: 'izquierda' | 'derecha';
}): React.ReactElement {
  const Flecha = lado === 'izquierda' ? ChevronsRight : ChevronsLeft;
  return (
    <button
      type="button"
      onClick={onAbrir}
      style={{ width: RIEL }}
      aria-label={`Abrir ${titulo}`}
      title={`Abrir ${titulo}`}
      className={
        'flex shrink-0 flex-col items-center gap-3 border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-3 text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)] ' +
        (lado === 'izquierda' ? 'border-r' : 'border-l')
      }
    >
      <Flecha size={15} className="shrink-0" />

      {contador !== null && (
        <span className="rounded-[7px] bg-[var(--color-bg-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-fg)]">
          {contador}
        </span>
      )}

      {/*
        El título en vertical. `writing-mode` y no una rotación con transform:
        rotando, el texto sigue ocupando el ancho horizontal y desborda el riel.
      */}
      <span
        className="text-[11px] uppercase tracking-[0.14em]"
        style={{ writingMode: 'vertical-rl' }}
      >
        {titulo}
      </span>
    </button>
  );
}
