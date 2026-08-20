/**
 * Fetch server-side al backend, autenticado con la cookie httpOnly de sesión
 * (Item A, Etapa 2 — server components).
 *
 * Lee `casino_{panel}_at` con `cookies()` de next/headers y llama al backend con
 * `Authorization: Bearer`. Devuelve la data, o `null` si no hay sesión / el
 * token venció (401) / falla la red — así el server component degrada elegante
 * y el componente cliente hace su fetch normal.
 *
 * El middleware (Fase A) rota la cookie ANTES del render cuando el token venció,
 * así que en la práctica el `at` que lee `cookies()` acá suele estar fresco.
 */

import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { cookieNames, panelFrom, type Panel } from '@/lib/auth-cookies';
import type { TenantUser } from '@/lib/auth-context';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const TENANT_HOST = process.env.NEXT_PUBLIC_TENANT_HOST ?? 'demo.localhost';

export async function serverApiGet<T>(
  path: string,
  panel: Panel = 'admin',
): Promise<T | null> {
  try {
    const store = await cookies();
    const accessToken = store.get(cookieNames(panel).at)?.value;
    if (!accessToken) return null;

    const res = await fetch(`${API_URL}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Tenant-Host': TENANT_HOST,
        'X-Panel': panel,
      },
      // Data por usuario/sesión: nunca cachear entre requests.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface MeResponse {
  user: TenantUser;
}

/**
 * Resuelve el user autenticado SERVER-SIDE (cookie → `/tenant/auth/me`).
 * Deduplicado por request con `React.cache()` (varios server components que lo
 * pidan → un solo /me). Panel del header `x-panel` que setea el middleware.
 * Guest (sin cookie) → `null` sin llamar al backend.
 */
export const getServerUser = cache(async (): Promise<TenantUser | null> => {
  const h = await headers();
  const panel = panelFrom(h.get('x-panel'));
  const me = await serverApiGet<MeResponse>('/tenant/auth/me', panel);
  return me?.user ?? null;
});
