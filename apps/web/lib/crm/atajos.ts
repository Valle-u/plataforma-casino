/**
 * Los atajos de teclado de la bandeja, en un solo lugar.
 *
 * La tabla la usan **dos cosas**: el que escucha las teclas y la ayuda que se
 * abre con `?`. Con dos copias, un atajo nuevo funciona pero no figura en la
 * ayuda —o peor, figura uno que ya no existe— y el operador prueba una tecla
 * que no hace nada.
 *
 * ## Por qué hay que ignorar el teclado dentro de un campo de texto
 *
 * Es lo más importante de este archivo. `e` resuelve la conversación y `r`
 * salta al compositor: si los atajos corrieran mientras se escribe, la palabra
 * "espera" cerraría la conversación en la primera letra.
 *
 * `esFocoDeTexto` es lo que lo impide, y por eso está acá y no adentro del
 * componente: es la regla, no un detalle de implementación.
 *
 * ## Lo que el diseño pide y no está
 *
 * - **`n` — nota interna.** Las notas internas sobre una conversación no
 *   existen en el backend. Un atajo que abre un modo que en realidad manda el
 *   texto al jugador es peor que no tener el atajo.
 * - **`c` — cargar fichas.** La caja desde el chat quedó **diferida**, no
 *   descartada (bloque 7 de `docs/crm/14-decisiones.md`).
 *
 * Ninguno de los dos figura en la ayuda: prometer una tecla que no hace nada
 * es la forma más rápida de que el operador deje de creerle a la lista.
 */

export interface Atajo {
  /** La tecla, tal como la reporta `event.key` (en minúscula). */
  tecla: string;
  /** Cómo se escribe en la ayuda. */
  muestra: string;
  descripcion: string;
}

export const ATAJOS: Atajo[] = [
  { tecla: 'k', muestra: '⌘K', descripcion: 'Buscar conversaciones y secciones' },
  { tecla: 'j', muestra: 'j', descripcion: 'Bajar en la lista' },
  { tecla: 'k', muestra: 'k', descripcion: 'Subir en la lista' },
  { tecla: 'r', muestra: 'r', descripcion: 'Responder (foco en el mensaje)' },
  { tecla: '/', muestra: '/', descripcion: 'Foco en el mensaje' },
  { tecla: 'e', muestra: 'e', descripcion: 'Resolver la conversación' },
  { tecla: 'f', muestra: 'f', descripcion: 'Mostrar u ocultar la ficha' },
  { tecla: '?', muestra: '?', descripcion: 'Esta ayuda' },
  { tecla: 'escape', muestra: 'esc', descripcion: 'Cerrar lo que esté abierto' },
];

/**
 * ¿El foco está en algo donde se escribe?
 *
 * Cubre los tres casos: campos, áreas de texto y cualquier cosa marcada como
 * editable. El `select` va también — las flechas y las letras ahí eligen una
 * opción, y un atajo se las robaría.
 */
export function esFocoDeTexto(destino: EventTarget | null): boolean {
  const el = destino as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.isContentEditable === true;
}

/**
 * ¿Este evento es el de abrir la paleta?
 *
 * `⌘K` en Mac y `Ctrl+K` en el resto. Se acepta **aunque el foco esté en un
 * campo**: es una combinación con modificador, así que no choca con escribir —
 * y quien está redactando una respuesta también quiere poder saltar a otra
 * conversación.
 */
export function esAbrirPaleta(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
}
