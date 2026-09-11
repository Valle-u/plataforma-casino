/**
 * El historial del contacto (**4.3**).
 *
 * `crm_timeline_events` existía desde que se creó el CRM y **hasta acá no la
 * leía nadie**: los vínculos y desvínculos se guardaban y sólo se veían
 * consultando la base a mano. Esta es la pantalla que faltaba.
 *
 * ## Qué muestra, y qué no
 *
 * **No los mensajes.** Ésos están en el hilo, a la izquierda. Acá va lo que pasó
 * *alrededor* de la conversación y que no se puede reconstruir mirándola: quién
 * vinculó a este contacto con un jugador, quién dio de alta, cuándo se resolvió,
 * si se le avisó a su operador.
 *
 * ## Se pide al abrir la ficha, no al desplegar
 *
 * Es una consulta con índice sobre `(contact_id, occurred_at)` y devuelve como
 * mucho cincuenta filas. Esconderla detrás de un clic ahorraría poco y haría que
 * nadie la mire — y el valor de un historial es justamente que esté cuando uno
 * no lo estaba buscando.
 */

'use client';

import { useEffect, useState } from 'react';
import {
  CircleCheck,
  Link2,
  Loader2,
  Send,
  Unlink,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { timelineDelContacto, type EventoDeLaLinea } from '@/lib/chat/crm-api';

/**
 * Un ícono por tipo de evento.
 *
 * El `type` es texto libre en la base a propósito —para poder sumar eventos sin
 * migrar— así que acá hay un default en vez de un `Record` exhaustivo: un tipo
 * que esta pantalla todavía no conoce se muestra igual, con su texto, que es lo
 * que importa. Preferible a que desaparezca del historial.
 */
const ICONOS: Record<string, LucideIcon> = {
  link: Link2,
  unlink: Unlink,
  alta: UserPlus,
  estado: CircleCheck,
  aviso: Send,
};

export function LineaDeTiempo({
  contactId,
}: {
  contactId: string;
}): React.ReactElement {
  const [eventos, setEventos] = useState<EventoDeLaLinea[] | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setEventos(null);
    timelineDelContacto(contactId)
      .then((e) => vivo && setEventos(e))
      // Un historial que no carga no puede romper la ficha: lo que importa —la
      // identidad, la plata, los botones— está arriba y no depende de esto.
      .catch(() => vivo && setEventos([]))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [contactId]);

  if (cargando) {
    return (
      <Loader2 size={13} className="animate-spin text-[var(--color-fg-subtle)]" />
    );
  }

  if (!eventos || eventos.length === 0) {
    return (
      <span className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
        Todavía no pasó nada que anotar. Acá van a quedar los vínculos, las altas
        y los cambios de estado.
      </span>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {eventos.map((e) => {
        const Icono = ICONOS[e.type] ?? CircleCheck;
        return (
          <li key={e.id} className="flex gap-2">
            <Icono
              size={12}
              className="mt-[3px] shrink-0 text-[var(--color-fg-subtle)]"
            />
            <div className="flex min-w-0 flex-col">
              <span className="text-[11.5px] leading-snug text-[var(--color-fg)]">
                {e.summary}
              </span>
              <span className="text-[10.5px] text-[var(--color-fg-subtle)]">
                {cuando(e.occurredAt)}
                {/*
                  Sin actor = el usuario ya no está en el sistema. El evento se
                  muestra igual: que el que lo hizo haya desaparecido no borra
                  que la cosa pasó, y esconderlo dejaría huecos sin explicación.
                */}
                {e.actor ? ` · ${e.actor.username}` : ''}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Fecha y hora cortas. El historial se lee de un vistazo, no se audita acá. */
function cuando(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
