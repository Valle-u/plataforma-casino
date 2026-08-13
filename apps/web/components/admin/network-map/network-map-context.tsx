/**
 * Contexto de interacción del mapa de red. Los nodos custom (renderizados por
 * React Flow) leen de acá los handlers, sin prop-drilling.
 */

'use client';

import { createContext, useContext } from 'react';

export interface NetworkMapHandlers {
  /** Colapsar/expandir los hijos de un nodo comercial. */
  toggleCollapse: (id: string) => void;
  /** Abrir la lista de jugadores de un padre (nodo "N jugadores"). */
  openPlayers: (parentUserId: string, parentLabel: string) => void;
}

const noop: NetworkMapHandlers = {
  toggleCollapse: () => {},
  openPlayers: () => {},
};

const NetworkMapContext = createContext<NetworkMapHandlers>(noop);

export const NetworkMapProvider = NetworkMapContext.Provider;

export function useNetworkMapHandlers(): NetworkMapHandlers {
  return useContext(NetworkMapContext);
}
