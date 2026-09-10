/**
 * La tabla de atajos, que se abre con `?`.
 *
 * Se arma desde `ATAJOS`, la misma lista que escucha el teclado. Con una tabla
 * escrita a mano acá, un atajo nuevo funcionaría sin figurar —o peor, figuraría
 * uno que ya no existe— y el operador probaría una tecla que no hace nada.
 */

'use client';

import { X } from 'lucide-react';
import { ATAJOS } from '@/lib/crm/atajos';

export function AyudaDeAtajos({ onCerrar }: { onCerrar: () => void }): React.ReactElement {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Atajos de teclado"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="flex w-full max-w-[520px] flex-col gap-3 rounded-[16px] border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-[0_30px_70px_-20px_rgba(0,0,0,.9)]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[17px] font-bold text-[var(--color-fg)]">
            Atajos de teclado
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="flex size-7 items-center justify-center rounded-[9px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]"
          >
            <X size={15} />
          </button>
        </div>

        <ul className="flex flex-col">
          {ATAJOS.map((a) => (
            <li
              key={`${a.muestra}-${a.descripcion}`}
              className="flex items-center gap-3 border-b border-[var(--color-border)] py-1.5 last:border-b-0"
            >
              <kbd className="min-w-[44px] shrink-0 rounded-[7px] bg-[var(--color-bg-subtle)] px-2 py-0.5 text-center font-mono text-[11.5px] text-[var(--color-fg)]">
                {a.muestra}
              </kbd>
              <span className="text-[12.5px] text-[var(--color-fg-muted)]">
                {a.descripcion}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-[11.5px] leading-snug text-[var(--color-fg-subtle)]">
          Mientras escribís en un campo, las teclas sueltas no hacen nada — sólo{' '}
          <kbd className="font-mono">⌘K</kbd>, que lleva modificador.
        </p>
      </div>
    </div>
  );
}
