/**
 * El texto del aviso de derivación (**D8**).
 *
 * ## Por qué esto vive solo, en su propio archivo
 *
 * Es **el único punto del sistema donde un dato cruza de una bandeja a otra**.
 * Todo lo demás del CRM está aislado por construcción: los contactos son de una
 * bandeja (`D6`), las notas y etiquetas cuelgan del contacto, y nadie ve las
 * conversaciones de otra red (`D7`).
 *
 * Acá no. Acá se arma, a propósito, un mensaje que sale de una bandeja y entra
 * en otra. Si ese texto alguna vez incluyera lo que la persona escribió, la
 * decisión `D8` quedaría rota **sin que nada falle**: el aviso saldría igual,
 * más completo, y nadie se enteraría hasta que un socio leyera la queja que un
 * jugador hizo sobre él.
 *
 * Por eso no es un `template string` en medio de un servicio: es una función
 * chica, sola, con tests. **Y su firma es la garantía**: no recibe el mensaje,
 * así que no puede filtrarlo aunque alguien se distraiga.
 *
 * ## Qué dice, y qué no
 *
 * Dice **quién** escribió, **cuándo** y **a dónde**. No dice qué escribió.
 */

/** Zona del casino. El operador que lee esto está en Argentina. */
const ZONA = 'America/Argentina/Buenos_Aires';

export interface DatosDelAviso {
  /** Cómo se llama la persona, como para mostrarlo. */
  nombre: string;
  /** Cuándo escribió. */
  cuando: Date;
  /**
   * A qué bandeja escribió, en palabras: `'el casino'` o el nombre del
   * operador que la atiende. Nunca el contenido de la conversación.
   */
  origen: string;
}

/**
 * Arma el cuerpo del aviso.
 *
 * ⚠️ **No agregar un parámetro con el mensaje.** Ver arriba: la ausencia de ese
 * parámetro es lo que hace imposible filtrar el contenido.
 */
export function textoDelAviso(datos: DatosDelAviso): string {
  return [
    `${nombreLimpio(datos.nombre)} escribió ${aDondeEscribio(datos.origen)} el ${momento(datos.cuando)}.`,
    'Se le pidió que te contacte.',
  ].join('\n');
}

/**
 * `a` + origen, contrayendo cuando corresponde.
 *
 * En castellano `a` + `el` es `al`: sin esto el aviso diría *"escribió a el
 * casino"*. Es un detalle, pero lo lee un operador todos los días.
 */
function aDondeEscribio(origen: string): string {
  return origen.startsWith('el ') ? `al ${origen.slice(3)}` : `a ${origen}`;
}

/**
 * Fecha y hora legibles para alguien que no programa: `08/09 a las 14:32`.
 *
 * Sin el año: un aviso se lee el día que llega, y el año sólo hace ruido.
 *
 * ⚠️ El día y el mes se rellenan **a mano**. `Intl` con `day: '2-digit'` y
 * `month: '2-digit'` devuelve `8/9` y no `08/09` cuando se piden sólo esos dos
 * campos: el relleno depende del patrón que el locale tenga para esa
 * combinación, no de las opciones. Se descubrió con un test que esperaba
 * `08/09`.
 */
function momento(cuando: Date): string {
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: ZONA,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(cuando);

  const parte = (tipo: Intl.DateTimeFormatPartTypes): string =>
    (partes.find((p) => p.type === tipo)?.value ?? '').padStart(2, '0');

  return `${parte('day')}/${parte('month')} a las ${parte('hour')}:${parte('minute')}`;
}

/**
 * Nombre en una línea y acotado.
 *
 * Un `display_name` sale de un formulario: puede traer saltos de línea o venir
 * larguísimo. Los saltos importan más de lo que parece — el aviso es un texto
 * de dos renglones, y un nombre con enters lo convierte en cualquier cosa.
 */
function nombreLimpio(nombre: string): string {
  const limpio = nombre.replace(/\s+/g, ' ').trim();
  if (!limpio) return 'Un contacto';
  return limpio.length > 60 ? `${limpio.slice(0, 59)}…` : limpio;
}
