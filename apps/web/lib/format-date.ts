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

/**
 * Argentina NO tiene horario de verano — offset fijo UTC-3 todo el año. Los
 * dos helpers de abajo lo usan directo (sin Intl) para no depender de la
 * zona horaria del navegador del operador, cumpliendo la misma decisión
 * dueño de arriba ("todas las fechas en hora AR, sin importar la zona del
 * navegador") también en los INPUTS de fecha, no solo en la presentación.
 */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * ISO/Date (UTC) → valor para `<input type="datetime-local">`, representando
 * ese instante en hora AR (`yyyy-MM-ddTHH:mm`).
 *
 * Bug que esto reemplaza: `iso.slice(0, 16)` toma la hora UTC cruda y se la
 * pasa tal cual al input — como el input no tiene timezone, el navegador la
 * interpreta como si YA fuera hora local, mostrando 3hs más tarde que la
 * hora AR real. Cerca de la medianoche eso corre la fecha mostrada al día
 * siguiente (ej: 01/08 21:00 AR = 02/08 00:00 UTC → se mostraba "02/08").
 */
export function isoToArDatetimeLocal(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // AR = UTC − 3hs → restamos el offset para que los campos UTC del Date
  // resultante (los que lee toISOString/slice) queden en hora AR.
  return new Date(d.getTime() - AR_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * Valor de `<input type="datetime-local">` (interpretado como hora AR) → ISO
 * UTC para mandar al backend. Contraparte de `isoToArDatetimeLocal`.
 */
export function arDatetimeLocalToIso(value: string): string | undefined {
  if (!value) return undefined;
  // "yyyy-MM-ddTHH:mm" sin timezone → forzamos 'Z' para que el parser lo lea
  // como si esos campos fueran UTC (sin corrimiento de zona), y sumamos el
  // offset AR para obtener el instante UTC real que representan.
  const asIfUtc = new Date(`${value}:00.000Z`);
  if (Number.isNaN(asIfUtc.getTime())) return undefined;
  return new Date(asIfUtc.getTime() + AR_OFFSET_MS).toISOString();
}

/** `yyyy-MM-dd` de HOY en el calendario de Argentina (no el del navegador). */
export function arTodayDateStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: AR_TZ });
}

/**
 * Fecha `yyyy-MM-dd` (calendario AR, ej. de un `<input type="date">`) → ISO
 * UTC del INICIO de ese día en hora AR (00:00:00.000).
 */
export function arStartOfDayIso(dateStr: string): string | undefined {
  return arDatetimeLocalToIso(`${dateStr}T00:00`);
}

/**
 * Fecha `yyyy-MM-dd` (calendario AR) → ISO UTC del FINAL de ese día en hora
 * AR (23:59:59.999) — inicio del día siguiente menos 1ms, para no depender
 * de precisión de minuto.
 */
export function arEndOfDayIso(dateStr: string): string | undefined {
  const start = arStartOfDayIso(dateStr);
  if (!start) return undefined;
  return new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
}

/** Primer día del mes en curso (calendario AR) → ISO UTC de su inicio (00:00 AR). */
export function arStartOfCurrentMonthIso(): string {
  const [y, m] = arTodayDateStr().split('-');
  return arStartOfDayIso(`${y}-${m}-01`)!;
}

/** `yyyy-MM-dd` de "hace N días" en el calendario de Argentina. */
export function arDaysAgoDateStr(days: number): string {
  const [y, m, d] = arTodayDateStr().split('-').map(Number);
  // Restamos días sobre un instante fijo (mediodía AR del día de hoy) para
  // no pisar un DST inexistente — Argentina no tiene, pero así evitamos
  // cualquier ambigüedad de UTC±0 en el borde del día.
  const noonArTodayUtc = new Date(arStartOfDayIso(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)!);
  const shifted = new Date(noonArTodayUtc.getTime() - days * 24 * 60 * 60 * 1000);
  return shifted.toLocaleDateString('en-CA', { timeZone: AR_TZ });
}
