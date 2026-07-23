/**
 * useIsDesktop — true si el viewport está en breakpoint lg (≥1024px).
 * Server-safe: devuelve false durante SSR para evitar hydration mismatch.
 * Se actualiza en resize via matchMedia listener.
 */

'use client';

import { useEffect, useState } from 'react';

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mql.matches);

    function onChange(e: MediaQueryListEvent) {
      setIsDesktop(e.matches);
    }
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
