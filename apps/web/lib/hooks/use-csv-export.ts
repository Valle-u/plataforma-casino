/**
 * Hook genérico de export CSV.
 *
 * Pattern:
 *   const { download, isLoading } = useCsvExport({
 *     path: '/tenant/audit-log/export',
 *     params: { actionCodePrefix: 'wallet.' },
 *     filenameHint: 'audit_log',
 *   });
 *   <Button onClick={download} disabled={isLoading}>...</Button>
 *
 * Internamente:
 *   1. fetch al backend con `Accept: text/csv` + auth + tenant header.
 *   2. Recibe blob → URL.createObjectURL → trigger download programático
 *      con `<a download>` invisible.
 *   3. Cleanup del object URL después del click.
 *
 * El backend ya graba el audit entry — el cliente NO necesita marcar nada.
 *
 * Errores comunes:
 *   - 403 → el user no tiene permission `<entity>.export` (mostrar toast).
 *   - 401 → token expiró (el shell del admin layout maneja redirect).
 *   - 5xx → red o backend caído.
 */

'use client';

import { useState } from 'react';
import { notifySessionExpired } from '../api-client';

const TOKEN_STORAGE_KEY = 'casino_admin_token';
const TENANT_HOST_STORAGE_KEY = 'casino_admin_tenant_host';
const DEFAULT_TENANT_HOST =
  process.env.NEXT_PUBLIC_TENANT_HOST ?? 'demo.localhost';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

function getTenantHost(): string {
  if (typeof window === 'undefined') return DEFAULT_TENANT_HOST;
  const override = window.localStorage.getItem(
    TENANT_HOST_STORAGE_KEY + '_override',
  );
  return override ?? DEFAULT_TENANT_HOST;
}

export interface CsvExportOptions {
  /** Path del endpoint (sin /api). Ej: '/tenant/audit-log/export'. */
  path: string;
  /** Query params opcionales — se serializan con URLSearchParams. */
  params?: Record<string, string | number | undefined | null>;
  /** Hint de nombre — el server ya manda Content-Disposition con timestamp,
   * pero si el navegador lo ignora usamos este como fallback. */
  filenameHint?: string;
}

export interface CsvExportApiError extends Error {
  status: number;
  /** Body del response si era JSON con `{ message }`. */
  body?: { message?: string; error?: string } | null;
}

function isCsvExportApiError(err: unknown): err is CsvExportApiError {
  return (
    err instanceof Error && typeof (err as CsvExportApiError).status === 'number'
  );
}

export { isCsvExportApiError };

/**
 * Hook con estado isLoading + función `download()`. No usa TanStack Query
 * porque el resultado es un side-effect (descarga), no datos cacheables.
 */
export function useCsvExport(opts: CsvExportOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<CsvExportApiError | null>(null);

  const download = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams();
      if (opts.params) {
        for (const [k, v] of Object.entries(opts.params)) {
          if (v === undefined || v === null || v === '') continue;
          search.set(k, String(v));
        }
      }
      const qs = search.toString();
      const url = `/api${opts.path}${qs ? `?${qs}` : ''}`;

      const headers: Record<string, string> = {
        Accept: 'text/csv',
        'X-Tenant-Host': getTenantHost(),
      };
      const token = getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 401) notifySessionExpired();
        let body: { message?: string; error?: string } | null = null;
        try {
          body = (await res.json()) as { message?: string; error?: string };
        } catch {
          body = null;
        }
        const err = new Error(body?.message ?? res.statusText) as CsvExportApiError;
        err.status = res.status;
        err.body = body;
        throw err;
      }

      // Filename del Content-Disposition (Express lo manda quoted).
      const cd = res.headers.get('content-disposition') ?? '';
      const match = /filename\s*=\s*"?([^"]+)"?/i.exec(cd);
      const filename =
        match?.[1] ??
        `${opts.filenameHint ?? 'export'}_${Date.now()}.csv`;

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        // Liberar el blob URL (algunos navegadores tardan; setTimeout 0 es seguro).
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
    } catch (err) {
      if (isCsvExportApiError(err)) {
        setError(err);
      } else {
        const wrapped = new Error(
          (err as Error)?.message ?? 'Error de conexión',
        ) as CsvExportApiError;
        wrapped.status = 0;
        setError(wrapped);
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { download, isLoading, error };
}
