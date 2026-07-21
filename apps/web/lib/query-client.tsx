/**
 * QueryClientProvider wrapper — config global de TanStack Query.
 *
 * Estrategia de caching (stale-while-revalidate):
 *   - `staleTime: 5min` — data se considera fresca por 5min. Sin refetch
 *     aunque el usuario navegue entre páginas.
 *   - `gcTime: 30min` — data stale se mantiene en cache 30min después de
 *     que el componente se desmonta. Si el usuario vuelve, ve data instantánea
 *     mientras se refresca en background.
 *   - `refetchOnWindowFocus: false` — evitar refetch al volver de otra
 *     pestaña. Los hooks críticos tienen su propio refetchInterval si
 *     necesitan datos "en vivo".
 *   - `retry: 1` — auto-recovery de blips de red. 401/403 no se reintentan.
 */

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { isApiError } from './api-client';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60_000,
            gcTime: 30 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (isApiError(error) && (error.status === 401 || error.status === 403)) {
                return false;
              }
              return failureCount < 1;
            },
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
