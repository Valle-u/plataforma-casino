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
  tagline: string | null;
}

export interface TenantDesign {
  slides: unknown;
  colors: unknown;
  texts: unknown;
  brand: unknown;
}

export interface TenantSiteConfig {
  maintenanceEnabled: boolean;
  registrationEnabled: boolean;
  announcementText: string | null;
  /** Si el teléfono es obligatorio al registrarse (default true). */
  phoneRequired?: boolean;
}

export interface TenantLimitsConfig {
  depositMin: number | null;
  withdrawalMin: number | null;
}

/** Apariencia del panel admin (2 knobs; el resto se deriva en el cliente). */
export interface TenantAdminAppearance {
  accent: string;
  bg: string;
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
  adminAppearance: TenantAdminAppearance | null;
  site: TenantSiteConfig;
  limits: TenantLimitsConfig;
}

export function useTenantInfo() {
  return useQuery({
    queryKey: ['tenant-info'],
    queryFn: () => apiGet<TenantInfoResponse>('/tenant/info'),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    // Sprint apariencia: al guardar la paleta se invalida ['tenant-info'];
    // con refetchOnMount el sitio del jugador toma los colores nuevos al
    // navegar/recargar sin necesidad de un F5 duro. El staleTime de 5min
    // evita refetches innecesarios en navegación normal.
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}
