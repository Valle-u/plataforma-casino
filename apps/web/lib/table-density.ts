/**
 * Densidad de tablas del panel (menú de cuenta · handoff lote 2).
 *
 * Preferencia personal Cómoda/Compacta, guardada en localStorage y aplicada
 * como `data-density` en <body>. La CSS (globals.css) ajusta el padding de
 * las filas de tabla (`.admin-td`) y el alto de los ítems del sidebar
 * (`.admin-nav-link`) cuando está en "compact".
 *
 * No hay backend: es una preferencia del dispositivo.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

export type TableDensity = 'comfortable' | 'compact';

const STORAGE_KEY = 'admin-table-density';
const EVENT = 'admin-density-change';

export function readDensity(): TableDensity {
  if (typeof window === 'undefined') return 'comfortable';
  try {
    return localStorage.getItem(STORAGE_KEY) === 'compact'
      ? 'compact'
      : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

/** Aplica la densidad al DOM + localStorage y avisa a los suscriptores. */
export function applyDensity(d: TableDensity): void {
  if (typeof document === 'undefined') return;
  document.body.dataset.density = d;
  try {
    localStorage.setItem(STORAGE_KEY, d);
  } catch {
    /* almacenamiento no disponible — se pierde la preferencia, no rompe */
  }
  window.dispatchEvent(new CustomEvent<TableDensity>(EVENT, { detail: d }));
}

/**
 * Hook para el toggle: devuelve la densidad actual y un setter. Aplica la
 * preferencia guardada al montar (por eso alcanza con montarlo una vez en el
 * header) y se sincroniza entre instancias vía un CustomEvent.
 */
export function useTableDensity(): [TableDensity, (d: TableDensity) => void] {
  const [density, setState] = useState<TableDensity>('comfortable');

  useEffect(() => {
    const current = readDensity();
    setState(current);
    applyDensity(current);
    const onChange = (e: Event): void => {
      setState((e as CustomEvent<TableDensity>).detail);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const set = useCallback((d: TableDensity) => {
    applyDensity(d);
    setState(d);
  }, []);

  return [density, set];
}
