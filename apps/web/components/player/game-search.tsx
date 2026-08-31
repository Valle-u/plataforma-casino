/**
 * GameSearch — el buscador de juegos, compartido por la home (`/play`) y el
 * lobby (`/play/lobby`).
 *
 * Existe como componente porque los dos tenían su propio buscador, con distinto
 * alto, distinto tamaño de texto y uno con etiqueta y el otro sin: pasar de una
 * sección a la otra se sentía como cambiar de sitio.
 *
 * El tamaño sale de un requisito, no de un gusto: buena parte de los jugadores
 * son personas mayores.
 *
 *   - **Etiqueta escrita**, no solo una lupa. Un ícono suelto no se lee como
 *     "acá se busca" si no creciste con esa convención.
 *   - **56px de alto y 16px de texto.** Los 16px además evitan que Safari haga
 *     zoom al enfocar, que desorienta.
 *   - **Botón de borrar de 40px**, no una crucecita de 16.
 */

'use client';

import { Search, X } from 'lucide-react';

export function GameSearch({
  value,
  onChange,
  label = 'Buscar un juego',
  placeholder = 'Escribí el nombre del juego',
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-[var(--color-fg-muted)]">
        {label}
      </span>
      <span className="relative block">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--color-fg-subtle)]"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="h-14 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] pl-12 pr-12 text-[16px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-glow)]"
        />
        {value !== '' && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Borrar la búsqueda"
            className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <X className="size-5" />
          </button>
        )}
      </span>
    </label>
  );
}
