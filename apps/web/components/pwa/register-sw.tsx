/**
 * RegisterServiceWorker — registra /sw.js (PWA, Sprint 55.x).
 *
 * Solo en producción: en dev el service worker cachea los chunks de
 * Next.js y pelea con HMR/refresh. En producción el SW es el vehículo
 * de instalabilidad + Web Push.
 *
 * El registro es fail-soft: si el browser no lo soporta o falla, la app
 * sigue funcionando normal (sin offline shell ni push).
 */
'use client';

import { useEffect } from 'react';

export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* fail-soft — no romper la app si el SW no se pudo registrar */
    });
  }, []);

  return null;
}
