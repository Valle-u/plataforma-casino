/**
 * Hook + helpers para branding del tenant (Sprint 29).
 *
 * Fetcha `GET /tenant/info` (público, sin auth) y devuelve:
 *   - tenantName: para mostrar en header.
 *   - branding.primaryColor: hex #RRGGBB o null (cae al default).
 *   - branding.logoUrl: URL HTTPS o null (cae al BrandMark SVG default).
 *
 * Cache largo (5min staleTime) — branding cambia raro. Refetch on focus
 * desactivado para no sobrecargar el endpoint.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export interface TenantBranding {
  primaryColor: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
}

export interface TenantDesign {
  slides: unknown;
  colors: unknown;
  texts: unknown;
  brand: unknown;
}

export interface TenantInfoResponse {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    planId: string | null;
  };
  branding: TenantBranding;
  design: TenantDesign | null;
}

export function useTenantInfo() {
  return useQuery({
    queryKey: ['tenant-info'],
    queryFn: () => apiGet<TenantInfoResponse>('/tenant/info'),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}
