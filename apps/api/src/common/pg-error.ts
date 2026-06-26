/**
 * Helpers para detectar códigos de error de Postgres de forma robusta.
 *
 * Con el driver `postgres` + Drizzle, el error de una query suele venir
 * envuelto en un `DrizzleQueryError` que guarda el `PostgresError` original
 * en `.cause` (a veces anidado). Chequear solo `err.code` (top-level) se
 * pierde el código real, así que recorremos la cadena de `.cause`.
 */

/** True si `err` (o algún `.cause` en la cadena) tiene el código pg dado. */
export function hasPgErrorCode(err: unknown, code: string): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur != null; i += 1) {
    if (
      typeof cur === 'object' &&
      (cur as { code?: unknown }).code === code
    ) {
      return true;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** True si el error es una violación de unicidad (23505). */
export function isUniqueViolation(err: unknown): boolean {
  return hasPgErrorCode(err, '23505');
}
