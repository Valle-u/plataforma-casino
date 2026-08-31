/**
 * Etiqueta visible de un código de moneda.
 *
 * `wallets.currency` guarda `'CHIPS'` — un código técnico, del mismo tipo que
 * `'ARS'` o `'USDT'`, que además se le manda a los proveedores de juego al abrir
 * una sesión. Ahí adentro está bien; el problema era que la interfaz lo imprimía
 * crudo y el operador terminaba leyendo "874.45 CHIPS" en el chat de soporte.
 *
 * En castellano la unidad se llama **ficha** (ver la regla 9 de `AGENTS.md` y la
 * entrada *Fichas* del glosario). "Chip" es la misma cosa en inglés, no otra
 * cosa: lo que no puede pasar es que la palabra en inglés llegue a la pantalla.
 *
 * Las monedas reales (ARS, USDT, BRL…) se devuelven tal cual: ahí el código ES
 * la forma correcta de mostrarlas.
 */

/** Códigos internos que no son una moneda real y tienen nombre propio en castellano. */
const ETIQUETAS: Record<string, string> = {
  CHIPS: 'fichas',
};

export function currencyLabel(code: string | null | undefined): string {
  if (!code) return '';
  return ETIQUETAS[code.trim().toUpperCase()] ?? code;
}
