/**
 * Hook del flujo de cargas por corrección/reintegro (docs/19).
 *
 * La corrección es SOLO para empleados de la red central (rol 'empleado',
 * rama dependiente). El admin carga con wallet.load (sale de la tesorería).
 *
 * Endpoints:
 *   - GET /tenant/correction/status → cupo del actor (cap, used, remaining).
 *   - POST /tenant/correction → aplica una corrección (drena la Casa).
 *   - PATCH /tenant/correction/user/:id/cap → admin fija el cupo de un empleado.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';
import { invalidateAllBalances } from '../query-balances';

export type CorrectionReasonType = 'correction' | 'refund' | 'other';

export interface CorrectionStatus {
  cap: string;
  used: string;
  remaining: string;
}

export interface CorrectionPayload {
  targetUserId: string;
  amount: string;
  reasonType: CorrectionReasonType;
  reasonNotes?: string;
}

export interface CorrectionResponse {
  transaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  };
  status: CorrectionStatus;
}

export interface EmployeeWithCap {
  userId: string;
  username: string;
  displayName: string;
  cap: string;
  used: string;
  remaining: string;
}

/** Cupo actual + consumo del mes de un usuario específico (admin). */
export function useUserCap(userId: string | null) {
  return useQuery({
    queryKey: ['correction-user-cap', userId],
    queryFn: () =>
      apiGet<{
        userId: string;
        username: string;
        displayName: string;
        cap: string;
        used: string;
        remaining: string;
      }>(`/tenant/correction/user/${userId}/cap`),
    enabled: !!userId,
    staleTime: 15_000,
  });
}

/** Lista de empleados con cupo > 0 (para el panel admin). */
export function useEmployeesWithCap(enabled = true) {
  return useQuery({
    queryKey: ['correction-employees'],
    queryFn: () =>
      apiGet<{ employees: EmployeeWithCap[] }>('/tenant/correction/employees'),
    enabled,
    staleTime: 15_000,
  });
}

/** Cupo del actor (el propio empleado logueado). */
export function useCorrectionStatus(enabled = true) {
  return useQuery({
    queryKey: ['correction-status'],
    queryFn: () => apiGet<CorrectionStatus>('/tenant/correction/status'),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

/** Genera una idempotency-key UUID v4 (browser-native crypto.randomUUID). */
export function newCorrectionIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Array.from({ length: 32 })
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
}

/**
 * Aplica una corrección: Casa → cliente, dentro del cupo.
 *
 * `idempotencyKey` es OBLIGATORIA (header Idempotency-Key, como load/burn).
 * El caller (el modal) genera una key al abrir el form y la reutiliza en
 * reintentos — un doble envío o un retry por timeout no duplica la carga.
 */
export function useApplyCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      idempotencyKey,
      ...payload
    }: CorrectionPayload & { idempotencyKey: string }) =>
      apiPost<CorrectionResponse>('/tenant/correction', payload, {
        idempotencyKey,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['correction-status'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
      // La corrección acredita la wallet del target y drena la Casa:
      // refresca todos los balances en el momento.
      invalidateAllBalances(qc);
    },
  });
}

/** Admin fija el cupo mensual de un empleado. */
export function useSetCorrectionCap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { userId: string; cap: string }) =>
      apiPatch<{ userId: string; cap: string }>(
        `/tenant/correction/user/${payload.userId}/cap`,
        { cap: payload.cap },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['correction-status'] });
      qc.invalidateQueries({ queryKey: ['correction-employees'] });
      qc.invalidateQueries({ queryKey: ['correction-user-cap'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}
