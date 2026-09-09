/**
 * Contraseña temporal para un jugador dado de alta desde el chat (**D9**).
 *
 * ## Por qué se genera y no se pide
 *
 * El alta pasa en medio de una conversación. Si el operador tuviera que
 * inventar una contraseña, terminaría poniendo la misma siempre.
 *
 * ## Por qué estos caracteres
 *
 * El operador la va a **dictar o copiar y pegar en un chat**, y la persona la
 * va a tipear en un teléfono. Así que quedan afuera los que se confunden:
 * `0`/`O`, `1`/`l`/`I`. Un jugador que escribe `O` en vez de `0` no entra y
 * vuelve a escribir — que es justo el trabajo que este alta viene a ahorrar.
 *
 * ## ⚠️ Lo que esto NO resuelve
 *
 * La plataforma **no sabe forzar el cambio al primer ingreso**: no existe
 * ninguna columna para eso. Mientras no exista, "temporal" es una convención,
 * no un mecanismo — la contraseña que se genere acá puede quedar siendo la
 * definitiva del jugador.
 */

import { randomInt } from 'node:crypto';

/**
 * Alfabeto sin caracteres ambiguos.
 *
 * Faltan a propósito: `0` `O` `o` (redondos), `1` `l` `I` (palitos), y `B`/`8`.
 */
const ALFABETO = 'acdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Una contraseña temporal legible.
 *
 * `randomInt` de `node:crypto` y no `Math.random()`: es una credencial, y
 * `Math.random()` no sirve para eso ni cuando "no importa mucho".
 */
export function generarPassword(largo = 10): string {
  let salida = '';
  for (let i = 0; i < largo; i++) {
    salida += ALFABETO[randomInt(ALFABETO.length)];
  }
  return salida;
}
