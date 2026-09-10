/**
 * Métricas de atención — cómo se está atendiendo, medido sobre **tramos**.
 *
 * ## Por qué no dice "conversaciones"
 *
 * Por **D11** el hilo es eterno: el que escribió en marzo y vuelve en septiembre
 * es la misma conversación. Sobre esa unidad los números obvios no significan
 * nada — "340 conversaciones abiertas" son todos los que alguna vez
 * escribieron. **Medir la conversación es medir la antigüedad del cliente.**
 *
 * El tramo va desde que alguien escribe estando la conversación resuelta hasta
 * que se vuelve a marcar resuelta. Un hilo eterno son muchos tramos cortos.
 *
 * ## Sin responder va primero, y ocupa más lugar
 *
 * No es una preferencia estética. Es la única métrica accionable **ahora**: las
 * demás cuentan lo que ya pasó, ésta dice quién está esperando en este momento.
 * `docs/crm/10-metricas.md` la llama "la única imprescindible" porque es la que
 * destapa el hueco de D16 + D17: sin ella alguien puede escribir y quedar dos
 * días sin que nadie en el sistema lo sepa.
 *
 * ## Todo dice sobre cuántos se calculó
 *
 * Una mediana sobre tres tramos y una sobre trescientos se leen igual y no
 * valen lo mismo. Sin el "sobre N", un número que salió de dos casos se toma
 * como una tendencia.
 *
 * ## Lo que no está, y no por falta de tiempo
 *
 * - **Ranking de operadores**: convierte la atención en una carrera, y el que
 *   cierra rápido no es el que atiende mejor.
 * - **Nada de otras redes** (**R6**).
 * - **Nada del contenido** de los mensajes.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  metricasDeAtencion,
  type MetricasDeAtencion,
} from '@/lib/chat/crm-api';
import { canalVisible } from '@/lib/crm/canales';
import { cn } from '@/lib/cn';

const VENTANAS = [7, 30] as const;
type Ventana = (typeof VENTANAS)[number];

export function Metricas(): React.ReactElement {
  const [ventana, setVentana] = useState<Ventana>(30);
  const [datos, setDatos] = useState<MetricasDeAtencion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(
    (dias: Ventana) => {
      let vivo = true;
      setCargando(true);
      metricasDeAtencion(dias)
        .then((d) => vivo && setDatos(d))
        .catch(() => vivo && setError('No se pudieron leer las métricas.'))
        .finally(() => vivo && setCargando(false));
      return () => {
        vivo = false;
      };
    },
    [],
  );

  useEffect(() => cargar(ventana), [cargar, ventana]);

  return (
    <div className="flex max-w-[900px] flex-col gap-4 py-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-[var(--color-fg)]">
          Métricas de atención
        </h1>
        <p className="text-[12.5px] text-[var(--color-fg-muted)]">
          Cómo se está atendiendo en tu bandeja. Se mide por{' '}
          <b>tramo</b>: cada vez que alguien escribe y se lo atiende hasta
          resolver.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-[12.5px] text-[var(--color-warning)]">
          {error}
        </p>
      )}

      {cargando && !datos ? (
        <Loader2 size={16} className="animate-spin text-[var(--color-fg-subtle)]" />
      ) : !datos ? null : (
        <>
          <SinResponder datos={datos} />

          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-[var(--color-fg-subtle)]">
              Ventana
            </span>
            {VENTANAS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setVentana(d)}
                className={cn(
                  'rounded-[9px] border px-2.5 py-1 text-[12px] transition-colors',
                  ventana === d
                    ? 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] font-semibold text-[var(--color-fg)]'
                    : 'border-[var(--color-border)] text-[var(--color-fg-muted)]',
                )}
              >
                {d} días
              </button>
            ))}
            {cargando && (
              <Loader2
                size={13}
                className="animate-spin text-[var(--color-fg-subtle)]"
              />
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Tarjeta
              titulo="Primera respuesta"
              valor={duracion(datos.medianaRespuesta)}
              nota={
                datos.respondidos > 0
                  ? `mediana, sobre ${datos.respondidos} ${plural(datos.respondidos, 'tramo', 'tramos')}`
                  : 'ningún tramo respondido todavía'
              }
            />
            <Tarjeta
              titulo="Hasta resolver"
              valor={duracion(datos.medianaResolucion)}
              nota={
                datos.resueltos > 0
                  ? `mediana, sobre ${datos.resueltos} ${plural(datos.resueltos, 'tramo', 'tramos')}`
                  : 'ningún tramo resuelto todavía'
              }
            />
          </div>

          {/*
            Se dice acá y no en un tooltip: la diferencia entre mediana y
            promedio es justo la que hace que el número sirva o mienta.
          */}
          <p className="text-[11.5px] leading-relaxed text-[var(--color-fg-subtle)]">
            Son <b>medianas</b>, no promedios: un solo caso de tres días
            arrastraría el promedio y escondería que el resto anduvo bien. Los
            tramos sin responder <b>no</b> entran en el cálculo — una espera que
            todavía no terminó no es una espera de cero.
          </p>

          <Flujo datos={datos} />
          <PorCanal datos={datos} />
          <DesdeCuando datos={datos} />
        </>
      )}
    </div>
  );
}

/**
 * Los que están esperando **ahora**. La única accionable en el momento.
 *
 * Cambia de color sola: en cero es un cartel tranquilo, con gente esperando es
 * una advertencia. Un número que se ve igual con 0 y con 12 no avisa nada.
 */
function SinResponder({
  datos,
}: {
  datos: MetricasDeAtencion;
}): React.ReactElement {
  const { total, viejos, masViejo } = datos.sinResponder;
  const alarma = total > 0;

  return (
    <section
      className={cn(
        'flex items-center gap-3 rounded-[14px] border p-3.5',
        alarma
          ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/[0.07]'
          : 'border-[var(--color-border)]',
      )}
    >
      {alarma && (
        <AlertTriangle
          size={18}
          className="shrink-0 text-[var(--color-warning)]"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
          Sin responder ahora
        </span>
        <span className="text-[12.5px] text-[var(--color-fg-muted)]">
          {total === 0
            ? 'Nadie está esperando. Todo lo que entró tuvo respuesta.'
            : viejos > 0
              ? `${viejos} ${plural(viejos, 'lleva', 'llevan')} más de 24 horas esperando${
                  masViejo ? ` · el más viejo desde ${cuando(masViejo)}` : ''
                }`
              : 'Todavía dentro de las 24 horas.'}
        </span>
      </div>
      <span
        className="font-display text-[34px] font-bold leading-none"
        style={{
          color: alarma ? 'var(--color-warning)' : 'var(--color-fg)',
        }}
      >
        {total}
      </span>
    </section>
  );
}

/**
 * Qué pasó con los tramos de la ventana.
 *
 * Los tres números son subconjuntos del primero, así que se muestran como
 * "de N, tantos" y no como tres tarjetas sueltas: sueltos parecerían
 * independientes y alguien los sumaría.
 */
function Flujo({ datos }: { datos: MetricasDeAtencion }): React.ReactElement {
  if (datos.tramos === 0) {
    return (
      <p className="text-[12.5px] text-[var(--color-fg-muted)]">
        No entró ningún tramo en los últimos {datos.ventana} días.
      </p>
    );
  }
  const sinResponderEnLaVentana = datos.tramos - datos.respondidos;

  return (
    <section className="flex flex-col gap-2 rounded-[14px] border border-[var(--color-border)] p-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        Últimos {datos.ventana} días
      </span>
      <p className="text-[13px] leading-relaxed text-[var(--color-fg)]">
        Entraron <b>{datos.tramos}</b>{' '}
        {plural(datos.tramos, 'tramo', 'tramos')}. Se{' '}
        {plural(datos.respondidos, 'respondió', 'respondieron')}{' '}
        <b>{datos.respondidos}</b> y se{' '}
        {plural(datos.resueltos, 'resolvió', 'resolvieron')}{' '}
        <b>{datos.resueltos}</b>.
      </p>
      {sinResponderEnLaVentana > 0 && (
        <p className="text-[11.5px] text-[var(--color-fg-muted)]">
          {sinResponderEnLaVentana}{' '}
          {plural(sinResponderEnLaVentana, 'quedó', 'quedaron')} sin una sola
          respuesta.
        </p>
      )}
    </section>
  );
}

/** Por dónde entra la gente. Sólo mensajes entrantes: los del operador no cuentan. */
function PorCanal({
  datos,
}: {
  datos: MetricasDeAtencion;
}): React.ReactElement | null {
  const total = datos.porCanal.reduce((s, c) => s + c.total, 0);
  if (total === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-[14px] border border-[var(--color-border)] p-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        Por dónde entran
      </span>
      {datos.porCanal.map((c) => {
        const canal = canalVisible(c.canal);
        const porcentaje = Math.round((c.total / total) * 100);
        return (
          <div key={c.canal} className="flex items-center gap-2.5">
            <span className="w-[74px] shrink-0 text-[12px] text-[var(--color-fg-muted)]">
              {canal.label || c.canal}
            </span>
            <span
              aria-hidden
              className="h-[6px] flex-1 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `max(2px, ${porcentaje}%)`,
                  background: canal.color,
                }}
              />
            </span>
            <span className="w-[86px] shrink-0 text-right font-mono text-[11.5px] text-[var(--color-fg-muted)]">
              {c.total} · {porcentaje}%
            </span>
          </div>
        );
      })}
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        Mensajes que entraron, no los que mandaste vos.
      </p>
    </section>
  );
}

/**
 * Desde cuándo hay algo medido.
 *
 * ⚠️ Es lo que evita el malentendido más caro de toda la sección: la medición
 * arrancó cuando se instalaron los tramos y **no hay datos anteriores**. Sin
 * esto, una ventana de 30 días recién estrenada se lee como un mes flojo en vez
 * de un mes que no se midió.
 */
function DesdeCuando({
  datos,
}: {
  datos: MetricasDeAtencion;
}): React.ReactElement {
  return (
    <div className="rounded-[12px] border-l-2 border-[var(--color-info,#8fb6ff)] bg-[var(--color-bg-subtle)] px-3 py-2.5">
      <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
        {datos.midiendoDesde ? (
          <>
            Se mide desde el <b>{cuando(datos.midiendoDesde)}</b>. Lo anterior no
            está: la medición empezó cuando se instaló, y lo que pasó antes no se
            puede reconstruir sin inventarlo.
          </>
        ) : (
          <>
            Todavía no hay nada medido. El primer tramo se abre cuando alguien te
            escriba; lo anterior a la instalación no se puede reconstruir.
          </>
        )}
      </p>
    </div>
  );
}

function Tarjeta({
  titulo,
  valor,
  nota,
}: {
  titulo: string;
  valor: string;
  nota: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5 rounded-[13px] border border-[var(--color-border)] px-3 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {titulo}
      </span>
      <span className="font-display text-[23px] font-bold leading-none text-[var(--color-fg)]">
        {valor}
      </span>
      <span className="text-[11px] text-[var(--color-fg-subtle)]">{nota}</span>
    </div>
  );
}

/**
 * Segundos a algo que se lee de un vistazo.
 *
 * Se corta en dos unidades: "2 h 10 min" alcanza para decidir, y "2 h 10 min 33
 * s" hace que haya que leerlo dos veces.
 */
function duracion(segundos: number | null): string {
  if (segundos === null) return '—';
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const restoMin = min % 60;
  if (horas < 24) {
    return restoMin > 0 ? `${horas} h ${restoMin} min` : `${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  const restoHoras = horas % 24;
  return restoHoras > 0 ? `${dias} d ${restoHoras} h` : `${dias} d`;
}

/** Hora si es de hoy, fecha si es de antes. */
function cuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString()
    ? `hoy ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      });
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}
