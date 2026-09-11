/**
 * Fronteras de día en la zona del casino (ruleta, etapa 2).
 *
 * El backend calcula el dayAnchor del giro con la `timezone` de la config del
 * wheel (Intl built-in, igual que acá). Para el "volvé mañana" en hora exacta
 * hay que saber el INSTANTE en que cambia el día en esa zona, no la medianoche
 * UTC ni el UTC+offset fijo (Argentina no tiene DST, pero otros tenants sí).
 *
 * Búsqueda acotada: 26 pasos de hora + como mucho 60 de minuto — suficiente
 * para cualquier zona del planeta (±14 h) y DST.
 */

const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = FMT_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    });
    FMT_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

function dayAnchorAt(ms: number, timeZone: string): string {
  return formatter(timeZone).format(new Date(ms));
}

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** El instante (ms epoch) en que empieza el día siguiente al de `ms`, en esa zona. */
export function nextAnchorAt(ms: number, timeZone: string): number {
  const anchor = dayAnchorAt(ms, timeZone);
  for (let h = 1; h <= 26; h += 1) {
    const t = ms + h * HOUR;
    if (dayAnchorAt(t, timeZone) !== anchor) {
      const base = ms + (h - 1) * HOUR;
      for (let m = 1; m <= 60; m += 1) {
        const t2 = base + m * MINUTE;
        if (dayAnchorAt(t2, timeZone) !== anchor) return t2;
      }
    }
  }
  return ms + 24 * HOUR; // fallback defensivo, no debería pasar
}

/** Tiempo que queda (ms) hasta el próximo giro, ≥ 0. */
export function remainingUntilNextAnchor(
  ms: number,
  timeZone: string,
  now: number = Date.now(),
): number {
  return Math.max(0, nextAnchorAt(ms, timeZone) - now);
}