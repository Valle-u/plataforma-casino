/**
 * useDebouncedValue — devuelve `value` recién después de `delayMs` sin cambios.
 *
 * Pattern típico para inputs de búsqueda que disparan queries de red:
 *   const [raw, setRaw] = useState('');
 *   const debounced = useDebouncedValue(raw, 300);
 *   const { data } = useQuery({ queryKey: ['search', debounced], ... });
 *
 * El input se siente instant (state local), pero la query se dispara solo
 * cuando el user pausa de tipear — evita N requests por keystroke.
 */

'use client';

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
