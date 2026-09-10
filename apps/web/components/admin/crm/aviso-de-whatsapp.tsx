/**
 * Lo que hay que saber **antes de escribir** en un hilo de WhatsApp (**3.4**).
 *
 * ## Por qué va arriba del compositor y no en un error
 *
 * Porque el error llega tarde. Un operador que escribe tres párrafos y recibe un
 * rechazo es un operador que deja de usar la herramienta — y en WhatsApp el
 * rechazo ni siquiera es inmediato ni claro. La regla del producto está escrita
 * en `03-canales.md` con todas las letras: *la pantalla tiene que decirlo ANTES
 * de que el operador escriba, no después de que el mensaje falle.*
 *
 * ## Son dos cosas distintas, y las dos son ciertas
 *
 * **1. La ventana de 24 h.** Desde el último mensaje **del cliente** hay 24
 * horas para contestar libremente; después sólo salen plantillas aprobadas por
 * Meta. Choca con **D11** —el hilo es eterno— de una forma invisible: reabrir
 * una conversación de hace meses **no reabre la ventana**, y el hilo se ve igual
 * de normal que cualquier otro.
 *
 * **2. Todavía no sale nada por WhatsApp.** El despacho a canales externos hoy
 * sólo reconoce Telegram, así que un mensaje escrito acá **se guardaría, se
 * vería como enviado y no llegaría a ningún lado**. Es el mismo agujero que 2.7
 * tapó para Telegram, y por eso el compositor queda bloqueado.
 *
 * ## Por qué las dos juntas y no la ventana sola
 *
 * Porque la ventana sola sería **peor que nada**. Un cartel verde diciendo "te
 * quedan 20 horas para responder libremente" sobre un canal que no entrega nada
 * es una mentira tranquilizadora: le da al operador confianza para escribir
 * justo donde el mensaje se pierde.
 *
 * ⚠️ **Para el que venga a construir el envío por WhatsApp:** cuando eso exista,
 * lo que se saca es `SinEnvio` y el bloqueo del compositor. **La ventana se
 * queda** — ahí recién empieza a ser la restricción que manda.
 */

'use client';

import { useEffect, useState } from 'react';
import { Clock, Lock, TriangleAlert } from 'lucide-react';

/** Debajo de esto el aviso se muestra; arriba sería un contador de adorno. */
const AVISAR_CUANDO_FALTAN_HORAS = 4;

/**
 * ¿Este hilo es de WhatsApp?
 *
 * Se pregunta por la ventana y no por el `channelType` porque **la ventana es la
 * respuesta del backend a esa misma pregunta**: viene `null` para todo canal que
 * no la tenga. Mirar el tipo de canal acá sería una segunda copia de esa regla,
 * y la que se desactualice deja de avisar sin que nadie lo note.
 */
export function esDeWhatsapp(
  ventana: { vence: string | null } | null | undefined,
): boolean {
  return ventana != null;
}

export function AvisoDeWhatsapp({
  ventana,
}: {
  ventana: { vence: string | null } | null | undefined;
}): React.ReactElement | null {
  // El contador tiene que envejecer solo: una ventana que vence a las 18:04 no
  // puede seguir diciendo "quedan 3 minutos" a las 18:30 porque nadie recargó.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!esDeWhatsapp(ventana)) return null;

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <Ventana vence={ventana!.vence} ahora={ahora} />
      <SinEnvio />
    </div>
  );
}

/** El estado de la ventana: nunca se abrió, venció, o está por vencer. */
function Ventana({
  vence,
  ahora,
}: {
  vence: string | null;
  ahora: number;
}): React.ReactElement | null {
  if (vence === null) {
    return (
      <Banda tono="alerta" icono={<TriangleAlert size={12} />}>
        <b>Nunca escribió por acá.</b> La ventana de 24 h no se abrió, así que
        WhatsApp no deja mandar texto libre — sólo una plantilla aprobada.
      </Banda>
    );
  }

  const restan = new Date(vence).getTime() - ahora;

  if (restan <= 0) {
    return (
      <Banda tono="alerta" icono={<TriangleAlert size={12} />}>
        <b>La ventana de 24 h venció</b> {haceCuanto(-restan)}. Sólo sale una
        plantilla aprobada por Meta, y las plantillas todavía no están
        construidas.
      </Banda>
    );
  }

  // Con muchas horas por delante esto no es información: es un reloj corriendo
  // al lado del teclado. Se calla hasta que falte poco.
  if (restan > AVISAR_CUANDO_FALTAN_HORAS * 60 * 60 * 1000) return null;

  return (
    <Banda tono="aviso" icono={<Clock size={12} />}>
      Quedan <b>{cuantoFalta(restan)}</b> para responder libremente. Después sólo
      sale una plantilla aprobada.
    </Banda>
  );
}

/**
 * El bloqueo del compositor, dicho.
 *
 * Se saca junto con el `disabled` del compositor el día que exista el envío por
 * WhatsApp. Hasta entonces, escribir acá guardaría un mensaje que nadie recibe.
 */
function SinEnvio(): React.ReactElement {
  return (
    <Banda tono="apagado" icono={<Lock size={12} />}>
      <b>Todavía no se puede responder por WhatsApp desde acá.</b> El envío está
      construido para Telegram nada más. Si esto dejara escribir, el mensaje
      quedaría guardado y no le llegaría a nadie.
    </Banda>
  );
}

function Banda({
  tono,
  icono,
  children,
}: {
  tono: 'alerta' | 'aviso' | 'apagado';
  icono: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const estilo = {
    alerta: 'border-[var(--color-danger,#f2555a)] bg-[var(--color-danger-bg,rgba(242,85,90,.1))]',
    aviso: 'border-[var(--color-warning)] bg-[var(--color-warning-bg)]',
    apagado: 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)]',
  }[tono];

  return (
    <div
      className={`flex gap-1.5 rounded-[12px] border-l-2 px-2 py-1.5 text-[11.5px] leading-snug text-[var(--color-fg-muted)] ${estilo}`}
    >
      <span className="mt-px shrink-0">{icono}</span>
      <span>{children}</span>
    </div>
  );
}

/** `2 h 15 min`, `45 min`. Sin segundos: el contador tickea por minuto. */
function cuantoFalta(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60_000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/**
 * `hace 3 días`, `hace 5 h`, `recién`.
 *
 * En días cuando pasó de uno: el caso típico de D11 es un hilo de hace meses, y
 * *"hace 4128 horas"* no le dice nada a nadie.
 */
function haceCuanto(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}
