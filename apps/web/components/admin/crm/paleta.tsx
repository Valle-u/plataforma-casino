/**
 * La paleta de ⌘K: buscar una conversación o saltar a una sección.
 *
 * ## Por qué existe teniendo un buscador en la lista
 *
 * El buscador de la lista **filtra lo que ya está cargado** y sólo sirve
 * estando en la bandeja. La paleta atraviesa la app: se abre desde cualquier
 * sección, encuentra conversaciones **y** lugares, y con Enter va.
 *
 * ## Sólo lo que existe
 *
 * Las secciones que se ofrecen son las construidas. Las siete que están
 * apagadas en el menú tampoco aparecen acá: una paleta que te lleva a una
 * pantalla que no está es peor que una paleta corta.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search } from 'lucide-react';
import type { InboxItem } from '@/lib/chat/types';
import { nombreDelContacto } from '@/lib/chat/use-bandeja';
import { GRUPOS_DEL_CRM } from '@/lib/crm/secciones';
import { canalVisible } from '@/lib/crm/canales';
import { cn } from '@/lib/cn';

interface Resultado {
  id: string;
  titulo: string;
  detalle: string;
  ir: () => void;
}

export function Paleta({
  conversaciones,
  onElegirConversacion,
  onCerrar,
}: {
  conversaciones: InboxItem[];
  onElegirConversacion: (id: string) => void;
  onCerrar: () => void;
}): React.ReactElement {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const resultados = useMemo<Resultado[]>(() => {
    const q = texto.trim().toLowerCase();

    const convs: Resultado[] = conversaciones.map((item) => {
      const nombre = nombreDelContacto(item);
      const canal = canalVisible(item.channelType);
      return {
        id: `conv:${item.conversation.id}`,
        titulo: nombre,
        detalle: canal.label || 'Conversación',
        ir: () => {
          onElegirConversacion(item.conversation.id);
          onCerrar();
        },
      };
    });

    const secciones: Resultado[] = GRUPOS_DEL_CRM.flatMap((g) =>
      g.items
        .filter((i) => i.lista)
        .map((i) => ({
          id: `sec:${i.href}`,
          titulo: i.label,
          detalle: g.titulo,
          ir: () => {
            router.push(i.href);
            onCerrar();
          },
        })),
    );

    const todo = [...convs, ...secciones];
    if (!q) return todo.slice(0, 12);
    return todo
      .filter(
        (r) =>
          r.titulo.toLowerCase().includes(q) ||
          r.detalle.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [texto, conversaciones, onElegirConversacion, onCerrar, router]);

  // El cursor vuelve arriba en cada búsqueda: si se quedara donde estaba,
  // Enter abriría el tercer resultado de una lista que ya no es la misma.
  useEffect(() => setCursor(0), [texto]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Buscar"
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="flex w-full max-w-[620px] flex-col overflow-hidden rounded-[16px] border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[0_30px_70px_-20px_rgba(0,0,0,.9)]">
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] px-4">
          <Search size={16} className="shrink-0 text-[var(--color-fg-subtle)]" />
          <input
            ref={inputRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, resultados.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                resultados[cursor]?.ir();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCerrar();
              }
            }}
            placeholder="Buscar una conversación o una sección"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)]"
          />
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-1">
          {resultados.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12.5px] text-[var(--color-fg-muted)]">
              Nada coincide con eso.
            </p>
          ) : (
            resultados.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={r.ir}
                onMouseEnter={() => setCursor(i)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors',
                  i === cursor ? 'bg-[var(--color-bg-subtle)]' : '',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--color-fg)]">
                  {r.titulo}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                  {r.detalle}
                </span>
                {i === cursor && (
                  <CornerDownLeft
                    size={12}
                    className="shrink-0 text-[var(--color-fg-subtle)]"
                  />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
