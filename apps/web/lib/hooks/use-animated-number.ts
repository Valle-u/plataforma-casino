/**
 * useAnimatedNumber — animar un counter desde su valor previo al nuevo.
 *
 * Sprint 51.11 — dopamine moments.
 *
 * Uso típico:
 *   const balance = wallet.data?.balance ?? '0';
 *   const animated = useAnimatedNumber(Number(balance), 1200);
 *   // animated rampea de oldValue → newValue en 1200ms con easing.
 *
 * Easing: `easeOutQuart` — rampea rápido al principio y lento al final
 * (sensación de "llegada con elegancia"). Casinos / fintechs usan este
 * pattern porque el ojo registra "subió" antes de leer el final exacto.
 *
 * Performance:
 *   - requestAnimationFrame loop, sin librerías externas.
 *   - Si el valor no cambió, no anima (skip rerender).
 *   - Si el componente se desmonta mid-animation, cancelamos el RAF.
 *
 * Caso especial: primer mount → rampea desde 0. Esto da el efecto
 * "wow" cuando el player entra al dashboard.
 */

import { useEffect, useRef, useState } from 'react';

export function useAnimatedNumber(target: number, durationMs = 1000): number {
  // Valor visible — empieza en 0 (primer mount) o en el último target.
  const [value, setValue] = useState<number>(0);
  const fromRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const lastTargetRef = useRef<number>(0);

  useEffect(() => {
    // Si el target no cambió, no hacemos nada (evita re-renders inútiles).
    if (target === lastTargetRef.current) return;

    fromRef.current = value;
    startRef.current = null;
    lastTargetRef.current = target;

    const step = (ts: number): void => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = easeOutQuart(progress);
      const current =
        fromRef.current + (target - fromRef.current) * eased;
      setValue(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        // Asegurar landing exacto (evita rounding errors visibles).
        setValue(target);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // El value dentro de step es snapshot — no agregar a deps (causaría
    // restart constante). Es intencional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}
