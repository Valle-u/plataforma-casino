/**
 * Hook del panel de Tesorería / Casa (Blindaje núcleo económico, Parte B).
 *
 * Endpoint (requiere house.view):
 *   - GET /tenant/house → estado de la Casa (balance, bloqueado).
 *
 * Devuelve 404 HOUSE_NOT_PROVISIONED si el tenant todavía no tiene la Casa
 * provisionada (seed viejo) — la página lo maneja con un estado dedicado.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export interface HouseState {
  userId: string;
  username: string;
  displayName: string;
  /** Fichas disponibles de la Casa. */
  balance: string;
  /** Fichas bloqueadas de la Casa (holds). */
  lockedBalance: string;
}

export function useHouseState() {
  return useQuery({
    queryKey: ['house-state'],
    queryFn: () => apiGet<HouseState>('/tenant/house'),
    staleTime: 15_000,
    retry: false, // un 404 (no provisionada) no se reintenta.
  });
}
