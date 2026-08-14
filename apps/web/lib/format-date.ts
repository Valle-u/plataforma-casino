/**
 * Formateo de fechas en hora de Argentina (America/Argentina/Buenos_Aires).
 *
 * Decisión dueño (2026-08-14): TODAS las fechas que ve el operador se muestran
 * en hora local AR, sin importar la zona del navegador. Los timestamps llegan
 * en UTC desde la API; acá se convierten. Usar SIEMPRE estos helpers en vez de
 * `toLocaleString` suelto (que depende de la zona de la PC y confunde).
 */

const AR_TZ = 'America/Argentina/Buenos_Aires';

/** `dd/mm/aa hh:mm` en hora AR (compacto, para tablas/bitácora). */
export function formatArDateTime(
  value: string | number | Date,
  opts?: { seconds?: boolean; fullYear?: boolean },
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-AR', {
    timeZone: AR_TZ,
    day: '2-digit',
    month: '2-digit',
    year: opts?.fullYear ? 'numeric' : '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(opts?.seconds ? { second: '2-digit' } : {}),
    hour12: false,
  });
}

/** `dd/mm/aaaa` en hora AR (solo fecha). */
export function formatArDate(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-AR', {
    timeZone: AR_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
