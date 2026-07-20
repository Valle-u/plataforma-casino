/**
 * RouteProgress — barra de progreso en la parte superior de la pantalla
 * que se activa al navegar entre rutas del admin.
 *
 * Usa usePathname() para detectar cambios de ruta y animar una barra
 * delgada que avanza progresivamente y se completa cuando la ruta carga.
 *
 * Colocar una vez en el admin layout.
 */

'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export function RouteProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    // Solo disparar si la ruta realmente cambió
    if (pathname === prevPathRef.current) return;
    prevPathRef.current = pathname;

    // Limpiar timer anterior
    if (timerRef.current) clearTimeout(timerRef.current);

    // Iniciar animación
    setVisible(true);
    setProgress(0);

    // Simular progreso: avanza rápido al inicio, más lento al final
    const steps = [
      { target: 30, delay: 50 },
      { target: 60, delay: 150 },
      { target: 80, delay: 400 },
      { target: 95, delay: 800 },
    ];

    let stepIndex = 0;
    function advanceStep() {
      if (stepIndex >= steps.length) return;
      const step = steps[stepIndex]!;
      timerRef.current = setTimeout(() => {
        setProgress(step.target);
        stepIndex++;
        advanceStep();
      }, step.delay);
    }
    advanceStep();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pathname]);

  // Completar y ocultar cuando llegamos a 95% (la ruta debería estar cargada)
  useEffect(() => {
    if (progress >= 95) {
      timerRef.current = setTimeout(() => {
        setProgress(100);
        setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 200);
      }, 100);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [progress]);

  if (!visible && progress === 0) return null;

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[9999] h-[2px] overflow-hidden transition-opacity duration-200',
        progress === 0 ? 'opacity-0' : 'opacity-100',
      )}
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Navegando…"
    >
      <div
        className="h-full bg-[var(--color-accent)] transition-all duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
