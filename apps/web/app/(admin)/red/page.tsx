/**
 * /red — Mapa de red. El árbol de texto viejo fue reemplazado por el mapa de
 * nodos interactivo (React Flow). Toda la lógica vive en NetworkMapView.
 *
 * React Flow (@xyflow/react) es pesado: cargamos NetworkMapView con
 * `next/dynamic` para que su chunk (y el CSS del mapa) no pese en la primera
 * carga. Se baja recién al entrar a la página, mostrando un skeleton mientras.
 */

'use client';

import dynamic from 'next/dynamic';

const NetworkMapView = dynamic(
  () => import('@/components/admin/network-map/network-map-view'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[70vh] w-full items-center justify-center text-sm text-[var(--color-fg-subtle)]">
        Cargando mapa de red…
      </div>
    ),
  },
);

export default function RedPage() {
  return <NetworkMapView />;
}
