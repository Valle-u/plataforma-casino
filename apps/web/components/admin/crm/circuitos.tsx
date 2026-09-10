/**
 * Circuitos — dónde está parada cada persona de la bandeja.
 *
 * ## No es un tablero de arrastrar tarjetas
 *
 * El diseño lo dibujaba como un kanban. No lo es, y no puede serlo: **la etapa
 * se calcula, no se elige**. Sale de hechos que ya existen —si tiene cuenta, si
 * depositó, cuándo jugó por última vez— así que no hay nada que mover. Arrastrar
 * una tarjeta a mano sería mentirle a la próxima consulta, que la va a devolver
 * a donde estaba.
 *
 * Lo que se gana: nunca queda desactualizado. Si alguien deposita por la caja
 * del panel un domingo a la madrugada, el lunes ya está en otra etapa sin que
 * nadie haya tocado nada.
 *
 * ## Es una foto, no un flujo
 *
 * Las etapas son excluyentes: cada contacto está en **una sola**, y los cinco
 * números suman el total. Eso quiere decir que esta pantalla contesta "¿dónde
 * está cada uno hoy?" y **no** "¿cuántos pasaron por acá?" ni "¿cuánto tardan
 * en depositar?". No hay historia guardada: nada registra cuándo alguien pasó
 * de una etapa a la siguiente.
 *
 * Por eso las barras son proporciones de la bandeja, no conversiones. Un
 * "42% de conversión" acá sería un número inventado.
 *
 * ## Para qué sirve entonces
 *
 * Para saber a quién escribirle. Cada etapa dice qué hacer con esa gente y abre
 * la lista de quiénes están ahí, con el botón que lleva a su conversación. Sin
 * eso sería un cartel con números.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import {
  contactosDeLaEtapa,
  contarEtapas,
  type ContactoEnEtapa,
  type PaginaDeEtapa,
} from '@/lib/chat/crm-api';
import {
  ETAPAS,
  type EtapaDelCircuito,
  type EtapaVisible,
} from '@/lib/crm/etapas';
import { cn } from '@/lib/cn';

export function Circuitos(): React.ReactElement {
  const [conteo, setConteo] = useState<Record<EtapaDelCircuito, number> | null>(
    null,
  );
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<EtapaDelCircuito | null>(null);

  useEffect(() => {
    let vivo = true;
    contarEtapas()
      .then((c) => vivo && setConteo(c))
      .catch(() => vivo && setError('No se pudieron leer los circuitos.'))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const total = conteo
    ? ETAPAS.reduce((suma, e) => suma + (conteo[e.clave] ?? 0), 0)
    : 0;

  return (
    <div className="flex max-w-[900px] flex-col gap-4 py-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-[var(--color-fg)]">
          Circuitos
        </h1>
        <p className="text-[12.5px] text-[var(--color-fg-muted)]">
          Dónde está parada hoy cada persona de tu bandeja. Se calcula solo, a
          partir de lo que ya hicieron.
        </p>
      </div>

      {/*
        Las dos advertencias que evitan que alguien lea mal la pantalla: que no
        hay tarjetas para arrastrar, y que los números no son conversiones. Las
        dos salieron de recortar el diseño contra lo que el sistema sabe.
      */}
      <div className="rounded-[12px] border-l-2 border-[var(--color-info,#8fb6ff)] bg-[var(--color-bg-subtle)] px-3 py-2.5">
        <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
          Las etapas <b>no se mueven a mano</b>: salen de si la persona tiene
          cuenta, si depositó y de cuándo jugó por última vez. Cada uno está en
          una sola, así que los números suman el total de tu bandeja. Es una foto
          de hoy, no un historial: no queda registro de cuándo alguien pasó de
          una etapa a la siguiente.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-[12.5px] text-[var(--color-warning)]">
          {error}
        </p>
      )}

      {cargando ? (
        <Loader2
          size={16}
          className="animate-spin text-[var(--color-fg-subtle)]"
        />
      ) : total === 0 ? (
        <p className="text-[12.5px] text-[var(--color-fg-muted)]">
          Todavía no te escribió nadie, así que no hay circuito que mirar.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {ETAPAS.map((etapa) => (
            <Tramo
              key={etapa.clave}
              etapa={etapa}
              cantidad={conteo?.[etapa.clave] ?? 0}
              total={total}
              abierta={abierta === etapa.clave}
              onAlternar={() =>
                setAbierta((a) => (a === etapa.clave ? null : etapa.clave))
              }
            />
          ))}
        </div>
      )}

      {/*
        Se dice en la pantalla, no sólo en el código: si el operador espera ver
        "alta pedida" y no la encuentra, va a asumir que está rota.
      */}
      <p className="text-[11.5px] leading-relaxed text-[var(--color-fg-subtle)]">
        Falta <b>Alta pedida</b>: no hay forma de saber que alguien pidió el alta
        y todavía no la tiene — nada lo registra. Va a aparecer cuando el pedido
        deje una marca.
      </p>
    </div>
  );
}

/**
 * Una etapa: el número, la barra, qué la define y qué hacer con esa gente.
 *
 * La barra es **la proporción sobre la bandeja**, no una conversión. Se dibuja
 * con un mínimo de 2px cuando hay al menos uno: una etapa con tres personas y
 * barra invisible se lee como vacía.
 */
function Tramo({
  etapa,
  cantidad,
  total,
  abierta,
  onAlternar,
}: {
  etapa: EtapaVisible;
  cantidad: number;
  total: number;
  abierta: boolean;
  onAlternar: () => void;
}): React.ReactElement {
  const porcentaje = total > 0 ? Math.round((cantidad / total) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-[14px] border border-[var(--color-border)]">
      <button
        type="button"
        onClick={onAlternar}
        disabled={cantidad === 0}
        aria-expanded={abierta}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--color-bg-subtle)] disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ background: etapa.color }}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13.5px] font-semibold text-[var(--color-fg)]">
              {etapa.label}
            </span>
            <span className="text-[11.5px] text-[var(--color-fg-subtle)]">
              {etapa.criterio}
            </span>
          </span>
          <span
            aria-hidden
            className="h-[5px] w-full overflow-hidden rounded-full bg-[var(--color-bg-subtle)]"
          >
            <span
              className="block h-full rounded-full transition-[width]"
              style={{
                width: cantidad === 0 ? 0 : `max(2px, ${porcentaje}%)`,
                background: etapa.color,
              }}
            />
          </span>
          <span className="text-[11.5px] text-[var(--color-fg-muted)]">
            {etapa.accion}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="flex flex-col items-end">
            <span className="font-display text-[22px] font-bold leading-none text-[var(--color-fg)]">
              {cantidad}
            </span>
            <span className="font-mono text-[10.5px] text-[var(--color-fg-subtle)]">
              {porcentaje}%
            </span>
          </span>
          {cantidad > 0 && (
            <ChevronDown
              size={15}
              className={cn(
                'text-[var(--color-fg-subtle)] transition-transform',
                abierta && 'rotate-180',
              )}
            />
          )}
        </span>
      </button>

      {abierta && <ListaDeLaEtapa etapa={etapa.clave} />}
    </section>
  );
}

/**
 * Quiénes están en la etapa. Se pide **recién al abrir**: traer las cinco
 * listas de entrada serían cinco consultas para mirar una.
 */
function ListaDeLaEtapa({
  etapa,
}: {
  etapa: EtapaDelCircuito;
}): React.ReactElement {
  const router = useRouter();
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<PaginaDeEtapa | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    contactosDeLaEtapa(etapa, pagina)
      .then((d) => vivo && setDatos(d))
      .catch(() => vivo && setDatos(null))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [etapa, pagina]);

  // Mismo salto que usa Contactos: la bandeja lee `?conv=` al montar y abre esa
  // conversación.
  const abrir = useCallback(
    (conversationId: string) => router.push(`/support?conv=${conversationId}`),
    [router],
  );

  const total = datos?.total ?? 0;
  const porPagina = datos?.pageSize ?? 50;
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  if (cargando && !datos) {
    return (
      <div className="border-t border-[var(--color-border)] px-3 py-5 text-center">
        <Loader2
          size={15}
          className="mx-auto animate-spin text-[var(--color-fg-subtle)]"
        />
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--color-border)]">
      <ul>
        {(datos?.items ?? []).map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[12.5px] font-medium text-[var(--color-fg)]">
                {nombreDe(c)}
              </span>
              <span className="truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">
                {c.username ?? c.phone ?? 'sin cuenta'}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[11px] text-[var(--color-fg-muted)]">
              {cuando(c.lastMessageAt)}
            </span>
            <button
              type="button"
              onClick={() => abrir(c.conversationId)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-[var(--color-border)] px-2 py-1 text-[11.5px] text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-strong)]"
            >
              <ExternalLink size={11} />
              Abrir
            </button>
          </li>
        ))}
      </ul>

      {total > porPagina && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 text-[11.5px] text-[var(--color-fg-muted)]">
          <span className="font-mono">
            {(pagina - 1) * porPagina + 1}–
            {Math.min(pagina * porPagina, total)} de {total}
          </span>
          <button
            type="button"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
            className="rounded-[8px] border border-[var(--color-border)] px-2 py-0.5 disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={pagina >= ultimaPagina}
            onClick={() => setPagina((p) => p + 1)}
            className="rounded-[8px] border border-[var(--color-border)] px-2 py-0.5 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

/** El nombre del jugador si tiene cuenta; si no, lo que haya dado el canal. */
function nombreDe(c: ContactoEnEtapa): string {
  return (
    c.userDisplayName ?? c.username ?? c.displayName ?? c.phone ?? 'Lead anónimo'
  );
}

/** Hora si es de hoy, fecha si es de antes. */
function cuando(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString()
    ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      });
}
