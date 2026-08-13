/**
 * Helpers para parsear los query params de los filtros de listados/export
 * (depósitos, retiros). Centralizados para que la lista y el CSV interpreten
 * los mismos parámetros igual.
 */

/** ISO string → Date, o undefined si falta o es inválida. */
export function parseDateParam(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * 'yes'/'true' → true (solo con transferencia matcheada),
 * 'no'/'false' → false (solo sin match), cualquier otra cosa → undefined.
 */
export function parseMatchedParam(s?: string): boolean | undefined {
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no' || s === 'false') return false;
  return undefined;
}
