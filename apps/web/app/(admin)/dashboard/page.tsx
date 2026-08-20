/**
 * /dashboard — server component (Item A, Etapa 2, Fase C: RSC del Inicio).
 *
 * Pre-carga server-side los datos de `useUsersStats` (leyendo la cookie de
 * sesión) y los hidrata en el cache de react-query, así los KPIs de usuarios
 * vienen ya en el HTML inicial (sin refetch en el cliente). El resto de la UI +
 * su data siguen en el cliente, idénticos (`DashboardClient`). Si no hay sesión
 * o falla la pre-carga → no se hidrata nada → el hook cliente hace su fetch
 * normal (degradación elegante).
 *
 * Solo se prefetchea `users-stats`: key estable (sin params ni permiso), la
 * misma que usa `useUsersStats`. Las KPIs de plata usan fecha computada +
 * permiso → se dejan client-side.
 */

import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';
import { serverApiGet } from '@/lib/server-api';
import DashboardClient from './dashboard-client';

export default async function DashboardPage() {
  const queryClient = new QueryClient();

  const stats = await serverApiGet('/tenant/users/stats');
  if (stats) {
    queryClient.setQueryData(['users-stats'], stats);
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardClient />
    </HydrationBoundary>
  );
}
