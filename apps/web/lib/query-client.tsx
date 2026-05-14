/**
 * QueryClientProvider wrapper — config global de TanStack Query.
 *
 * Decisiones:
 *   - `staleTime: 30s` default (data se considera fresca por 30s después
 *     de fetchearla — evita refetchs gratuitos en navegación).
 *   - `gcTime: 5min` default (mantiene cache 5min después de unmount).
 *   - `retry: 1` para auto-recovery de blips de red sin spam de requests
 *     si el endpoint está caído.
 *   - `refetchOnWindowFocus: true` — al volver al admin después de un
 *     rato, refrescamos data para que el operador siempre vea actual.
 *   - Errores con status 401/403 NO se reintentan (el token expiró o
 *     no tenemos permiso — retry no ayuda).
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
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
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
