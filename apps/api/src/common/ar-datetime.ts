/**
 * Formateo de fechas en hora de Argentina (America/Argentina/Buenos_Aires,
 * UTC-3, sin horario de verano).
 *
 * Decisión dueño (2026-08-14): TODAS las fechas que ve el operador —CSV de
 * auditoría, exports— van en hora local AR. Los timestamps se guardan en UTC
 * (append-only, E2) pero al mostrarlos siempre se convierten a AR para que no
 * confundan. NUNCA formatear en la zona del server (Railway corre en UTC).
 */

const AR_TZ = 'America/Argentina/Buenos_Aires';

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: AR_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * `dd/MM/yyyy HH:mm:ss` en hora de Argentina. Formato legible para Excel y
 * para el operador (que lee dd/mm naturalmente). Devuelve '' si la fecha es
 * nula/ inválida.
 */
export function formatArDateTime(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  const p: Record<string, string> = {};
  for (const part of dateTimeFmt.formatToParts(date)) {
    p[part.type] = part.value;
  }
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
