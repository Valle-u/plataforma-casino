/**
 * El teléfono como identidad — la **primera defensa de D4**.
 *
 * D4 dice que cuando entra un mensaje de un número desconocido, el sistema
 * busca ese teléfono entre los jugadores y lo vincula solo. Y la consecuencia
 * número uno que exige resolver es ésta: **normalizar antes de comparar**.
 * `3415551234`, `+543415551234` y `0341 15 555-1234` son el mismo número, y sin
 * normalizar el vínculo automático falla justo cuando más sirve.
 *
 * ## Por qué no alcanza con E.164
 *
 * Ésta es la parte que no es obvia y que rompe todo si se pasa por alto:
 *
 * ```
 * '0341 15 555-1234'  ->  +54 9 341 555-1234   (móvil: lleva el 9)
 * '341 555-1234'      ->  +54 341 555-1234     (sin el 9: se lee como fijo)
 * ```
 *
 * Son **la misma persona** y en E.164 estricto **no matchean**. En el plan de
 * numeración argentino está bien: el `15` nacional y el `9` internacional
 * marcan que es un móvil. Para identificar a alguien, no: WhatsApp siempre manda
 * la forma móvil (`5493415551234`), y el operador que cargó al jugador en el
 * panel escribió lo que tenía a mano.
 *
 * Por eso hay **dos formas canónicas distintas**, y usarlas al revés es un bug
 * silencioso:
 *
 * - `telefonoE164()` para **mostrar y guardar**.
 * - `claveDeTelefono()` para **comparar**: país + área + abonado, sin el `9`.
 *
 * ## Y por qué además hacen falta variantes
 *
 * La clave sirve para comparar dos entradas entre sí, pero `users.phone` es
 * **texto libre** cargado a mano a lo largo de años: ahí adentro hay de todo.
 * Normalizar la columna entera pediría una migración con backfill sobre una
 * tabla que usa todo el sistema.
 *
 * `variantesDeTelefono()` da la vuelta al problema: en vez de normalizar lo
 * guardado, enumera **las formas en que ese número pudo haberse escrito**, ya
 * sin separadores. La consulta compara los dígitos de `users.phone` contra esa
 * lista corta, apoyada en el índice funcional de la migración `0116`.
 *
 * ⚠️ Nada de esto vuelve infalible al vínculo, y no tiene que serlo: la
 * **segunda defensa de D4** —si matchea con más de un jugador, no vincular
 * ninguno— es la que ataja lo que se escape.
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** El país que se asume cuando el número viene sin prefijo internacional. */
const PAIS_POR_DEFECTO = 'AR' as const;

/** Código de país de Argentina, el único con regla propia acá. */
const ARGENTINA = '54';

/**
 * El teléfono en E.164 (`+5493415551234`), o `null` si no es un número válido.
 *
 * Es la forma para **mostrar y guardar**. Para comparar, `claveDeTelefono()`.
 */
export function telefonoE164(entrada: string | null | undefined): string | null {
  const p = parsear(entrada);
  return p ? p.e164 : null;
}

/**
 * La forma canónica para **comparar**: país + número nacional, **sin el `9` de
 * móvil argentino**. Sin `+` y sin separadores.
 *
 * ```
 * '+54 9 341 555-1234'  ->  '543415551234'
 * '0341 15 555-1234'    ->  '543415551234'
 * '341 555-1234'        ->  '543415551234'
 * ```
 *
 * `null` cuando no se puede afirmar qué número es. **Un `null` no vincula a
 * nadie**, que es lo correcto: ante la duda, lead sin vincular.
 */
export function claveDeTelefono(
  entrada: string | null | undefined,
): string | null {
  const p = parsear(entrada);
  return p ? `${p.cc}${p.nacional}` : null;
}

/**
 * Las formas en que ese número pudo haber quedado escrito en `users.phone`,
 * **sólo dígitos**, para comparar contra la columna sin normalizarla.
 *
 * Para un móvil argentino de área 341 y abonado 555-1234:
 *
 * ```
 * 3415551234       nacional, como se dicta
 * 03415551234      con el 0 de larga distancia
 * 0341155551234    con el 0 y el 15
 * 5493415551234    internacional móvil (lo que manda WhatsApp)
 * 543415551234     internacional sin el 9
 * ```
 *
 * No son adivinanzas: son las escrituras canónicas del **mismo** número. Lo que
 * no cubre —un dígito de más, un área mal cargada— no lo cubriría ninguna lista,
 * y para eso está la segunda defensa de D4.
 *
 * Devuelve `[]` si el número no se puede interpretar, lo que hace que la
 * consulta no matchee nada en vez de matchear cualquier cosa.
 */
export function variantesDeTelefono(
  entrada: string | null | undefined,
): string[] {
  const p = parsear(entrada);
  if (!p) return [];

  const variantes = new Set<string>([
    p.nacional,
    `${p.cc}${p.nacional}`,
  ]);

  if (p.cc === ARGENTINA) {
    // El `0` de larga distancia y el `15` de móvil, que es como lo escribe
    // cualquiera que lo copió de una agenda.
    variantes.add(`0${p.nacional}`);
    variantes.add(`${p.cc}9${p.nacional}`);
    for (const conQuince of conElQuince(p.nacional)) {
      variantes.add(`0${conQuince}`);
    }
  }

  return [...variantes];
}

/** ¿Dos teléfonos son el mismo, escritos como estén? */
export function mismoTelefono(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = claveDeTelefono(a);
  return ca !== null && ca === claveDeTelefono(b);
}

// ── Adentro ─────────────────────────────────────────────────────────────────

interface Parseado {
  /** Código de país, sin `+`. */
  cc: string;
  /** Número nacional **sin** el `9` de móvil argentino. */
  nacional: string;
  /** E.164 tal como lo devuelve la librería, con el `9` si lo lleva. */
  e164: string;
}

function parsear(entrada: string | null | undefined): Parseado | null {
  const texto = entrada?.trim();
  if (!texto) return null;

  const p = parsePhoneNumberFromString(texto, PAIS_POR_DEFECTO);
  // `isValid()` y no sólo "parseó": `15-4444-5555` parsea y no es válido —
  // le falta el área, así que **no se sabe de quién es**. Dejarlo pasar sería
  // vincular a alguien por medio número.
  if (!p || !p.isValid()) return null;

  const cc = String(p.countryCallingCode);
  let nacional = String(p.nationalNumber);

  // El `9` de móvil argentino se saca para comparar. Ningún área del país
  // empieza con 9 —son 11, 2xx, 3xx, 2xxx, 3xxx—, así que un 9 adelante de un
  // nacional de 11 dígitos siempre es el marcador de móvil y nunca parte del
  // número.
  if (cc === ARGENTINA && nacional.length === 11 && nacional.startsWith('9')) {
    nacional = nacional.slice(1);
  }

  return { cc, nacional, e164: p.number };
}

/**
 * El nacional argentino con el `15` metido después del área — la forma en que se
 * escribe un móvil dentro del país.
 *
 * Depende de saber **dónde termina el área**, y en Argentina mide 2, 3 o 4
 * dígitos (`11`, `341`, `2966`). Distinguir 3 de 4 pide la tabla entera de la
 * ENACOM, que además cambia.
 *
 * Por eso, cuando hay duda, **se emiten las dos**. Emitir una variante de más es
 * gratis: son dígitos que matchean o no matchean, y una combinación que no
 * corresponde a nadie simplemente no aparece en la tabla. Emitir mal cortada una
 * sola sería peor, porque dejaría de encontrar a quien sí está.
 */
function conElQuince(nacional: string): string[] {
  if (nacional.length !== 10) return [];

  // 11 = AMBA, el único área de dos dígitos del país.
  if (nacional.startsWith('11')) {
    return [`11` + `15` + nacional.slice(2)];
  }
  return [
    `${nacional.slice(0, 3)}15${nacional.slice(3)}`,
    `${nacional.slice(0, 4)}15${nacional.slice(4)}`,
  ];
}
