'use client';

import { useDynamicTitle } from '@/lib/hooks/use-dynamic-title';

/** Componente que actualiza el título del documento según la sección y la marca. */
export function DynamicTitleUpdater() {
  useDynamicTitle();
  return null;
}
