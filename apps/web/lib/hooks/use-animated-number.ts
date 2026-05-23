/**
 * useAnimatedNumber — animar un counter desde su valor previo al nuevo.
 *
 * Sprint 51.11 — dopamine moments.
 * Sprint 51.18 fix — lazy init para no flashear "0" en remount con cache.
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
 * BUG FIX 51.18 — "el balance desaparece al volver al home":
 *
 *   Antes: `useState<number>(0)` + `useRef(0)` en lastTargetRef. Cuando
 *   el user navegaba a otra pestaña y volvía, react-query servía el
 *   balance cacheado al instante (target=1000), pero el hook inicializaba
 *   `value=0` y el primer render mostraba "0,00" durante ~1 frame. El
 *   useEffect después arrancaba la animación de 0→1000. El usuario veía
 *   un flash "0,00" que interpretaba como "se borró".
 *
 *   Fix: lazy initializer en `useState(() => target)`. Si en el primer
 *   render ya hay un target real (cache hit), el primer paint muestra
 *   ese valor directamente — sin flash. La animación sigue funcionando
 *   en el flow "wallet.isLoading=true (target=0) → loading false (target=1000)",
 *   porque ese sí es un CAMBIO de target, no un mount con valor ya válido.
 *
 *   `lastTargetRef` también arranca en `target` para que el primer
 *   useEffect no dispare animación cuando ya estamos en el valor correcto.
 */

import { useEffect, useRef, useState } from 'react';

export function useAnimatedNumber(target: number, durationMs = 1000): number {
  // Lazy init: el primer paint ya muestra `target` si tenemos uno real.
  // Evita el flash "0,00" en remount con react-query cache hit.
  const [value, setValue] = useState<number>(() => target);
  const fromRef = useRef<number>(target);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  // También iniciamos en `target` — sino el primer useEffect detecta
  // "cambio" (0 → target) y dispara una animación innecesaria.
  const lastTargetRef = useRef<number>(target);

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
