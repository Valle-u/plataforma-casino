/**
 * La ventana de 24 horas de WhatsApp (**3.4**).
 *
 * Desde el último mensaje **del cliente** hay 24 horas para contestarle
 * libremente. Pasadas esas horas, Meta sólo deja salir **plantillas aprobadas**:
 * una respuesta escrita a mano a las 25 horas no se entrega.
 *
 * ## Por qué esto es una regla y no un detalle de pantalla
 *
 * Porque choca con **D11** —el hilo es eterno, una conversación cerrada se
 * reabre— de una forma que no se ve mirando el hilo:
 *
 * ```
 * 12-mar  Juan escribe · el operador responde · resuelta
 * 08-sep  el operador quiere escribirle por ese mismo hilo
 *         → la ventana venció hace meses
 *         → sólo sale una plantilla aprobada
 * ```
 *
 * Reabrir el hilo **no reabre la ventana**. Y esa es exactamente la trampa: la
 * conversación se ve normal, el compositor se ve normal, y el mensaje no llega.
 * Por eso la cuenta se hace sobre el último **inbound** y no sobre el último
 * mensaje ni sobre el estado de la conversación: lo único que abre la ventana es
 * que hable el cliente.
 *
 * ## Dónde vive la regla, y dónde no
 *
 * Acá. La pantalla recibe **cuándo vence** —un instante— y lo compara con su
 * reloj para dibujar el contador. Así el contador puede tickear sin que las 24
 * horas estén escritas en dos lados: el día que Meta las cambie, se cambian acá.
 *
 * ## Sólo WhatsApp
 *
 * Telegram **no tiene ventana**: si la persona le escribió al bot alguna vez, el
 * bot le puede contestar cuando quiera. El livechat tampoco. Mostrar el aviso en
 * esos canales no sería un detalle inofensivo — enseñaría al operador a
 * ignorarlo, y entonces tampoco lo leería en el único canal donde importa.
 */

/** Lo que Meta da para responder libremente, desde el último mensaje del cliente. */
export const HORAS_DE_LA_VENTANA = 24;

/** El único canal con ventana. Ver el docblock. */
export const CANAL_CON_VENTANA = 'whatsapp';

/**
 * El estado de la ventana de una conversación, tal como viaja a la pantalla.
 *
 * Ojo con los dos "no hay fecha", que **no significan lo mismo** y por eso no se
 * colapsan en uno:
 *
 * - `ventana === null` → **el canal no tiene ventana** (Telegram, livechat). No
 *   hay nada que avisar.
 * - `ventana.vence === null` → **es WhatsApp y el cliente nunca escribió**, así
 *   que la ventana no se abrió nunca. Es el caso más peligroso de los dos: el
 *   operador no puede mandar texto libre y nada en la pantalla se lo diría.
 *
 * Colapsarlos haría que el segundo se dibuje como el primero, o sea **sin
 * ningún aviso**, que es justo lo que este trabajo existe para evitar.
 */
export interface VentanaDe24h {
  /** Cuándo deja de salir el texto libre. `null` = nunca se abrió. */
  vence: string | null;
}

/**
 * El estado de la ventana de una conversación.
 *
 * Devuelve `null` cuando el canal no tiene ventana. No mira la hora actual **a
 * propósito**: informa cuándo vence, no si venció. Calcular acá el "ya venció"
 * lo dejaría congelado en el momento de la consulta, y un panel abierto toda la
 * tarde seguiría diciendo que quedan horas después de que se acabaron.
 */
export function ventanaDe(params: {
  channelType: string;
  /** El último mensaje **del cliente**. `null` si nunca escribió. */
  ultimoInbound: Date | string | null;
}): VentanaDe24h | null {
  if (params.channelType !== CANAL_CON_VENTANA) return null;

  const desde = aFecha(params.ultimoInbound);
  if (!desde) return { vence: null };

  return {
    vence: new Date(
      desde.getTime() + HORAS_DE_LA_VENTANA * 60 * 60 * 1000,
    ).toISOString(),
  };
}

/**
 * A `Date`, venga como venga de la base.
 *
 * Una subconsulta cruda no pasa por el mapeo de tipos de Drizzle, así que un
 * `timestamptz` puede llegar como `Date` o como string según el driver. Tomar
 * uno solo de los dos casos deja la ventana en `null` —o sea, sin aviso— en el
 * caso en que sí había que avisar.
 *
 * Una fecha que no se puede interpretar también vuelve `null`: preferimos que la
 * pantalla diga "no sé cuándo escribió" a inventar un vencimiento.
 */
function aFecha(valor: Date | string | null): Date | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}
