/**
 * Hook de payment methods (catálogo del tenant).
 *
 * Endpoints:
 *   - GET    /tenant/payment-methods?activeOnly=true     (público, user logueado)
 *   - GET    /tenant/payment-methods/:id                 (público)
 *   - POST   /tenant/payment-methods                     (permission `payment_methods.edit`)
 *   - PATCH  /tenant/payment-methods/:id                 (idem)
 *   - POST   /tenant/payment-methods/:id/archive         (idem)
 *
 * El backend NO valida el shape del `config` jsonb — el shape lo conoce
 * el frontend (CBU para bank_transfer, address para crypto, etc.).
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export type PaymentMethodType = 'bank_transfer' | 'crypto' | 'other';

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  type: PaymentMethodType;
  config: Record<string, unknown>;
  /** Fichas por unidad de la moneda del método (ratio ficha↔plata). String numeric. */
  chipsPerUnit: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PaymentMethodsResponse {
  data: PaymentMethod[];
}

export function usePaymentMethods(activeOnly = true) {
  return useQuery({
    queryKey: ['payment-methods', { activeOnly }],
    queryFn: () =>
      apiGet<PaymentMethodsResponse>(
        `/tenant/payment-methods?activeOnly=${activeOnly}`,
      ),
    // Catálogo del tenant — cambia raro. Cache largo.
    staleTime: 5 * 60_000,
  });
}

export function usePaymentMethodDetail(id: string | null) {
  return useQuery({
    queryKey: ['payment-method-detail', id],
    queryFn: () => apiGet<PaymentMethod>(`/tenant/payment-methods/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations (admin con permission `payment_methods.edit`)
// ──────────────────────────────────────────────────────────────────────

function invalidate(
  qc: ReturnType<typeof useQueryClient>,
  id?: string | null,
): void {
  qc.invalidateQueries({ queryKey: ['payment-methods'] });
  qc.invalidateQueries({ queryKey: ['audit-log'] });
  if (id) qc.invalidateQueries({ queryKey: ['payment-method-detail', id] });
}

export interface CreatePaymentMethodPayload {
  code: string;
  name: string;
  type: PaymentMethodType;
  config?: Record<string, unknown>;
  chipsPerUnit?: number;
  isActive?: boolean;
}

export function useCreatePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePaymentMethodPayload) =>
      apiPost<PaymentMethod>('/tenant/payment-methods', payload),
    onSuccess: () => invalidate(qc),
  });
}

export interface UpdatePaymentMethodPayload {
  name?: string;
  config?: Record<string, unknown>;
  chipsPerUnit?: number;
  isActive?: boolean;
}

export function useUpdatePaymentMethod(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdatePaymentMethodPayload) => {
      if (!id) throw new Error('payment method id requerido');
      return apiPatch<PaymentMethod>(`/tenant/payment-methods/${id}`, payload);
    },
    onSuccess: () => invalidate(qc, id),
  });
}

export function useArchivePaymentMethod(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!id) throw new Error('payment method id requerido');
      return apiPost<PaymentMethod>(
        `/tenant/payment-methods/${id}/archive`,
        {},
      );
    },
    onSuccess: () => invalidate(qc, id),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Player payment methods (GET /player/payment-methods)
// ──────────────────────────────────────────────────────────────────────

export function usePlayerPaymentMethods() {
  return useQuery({
    queryKey: ['player-payment-methods'],
    queryFn: () => apiGet<PaymentMethodsResponse>('/player/payment-methods'),
    staleTime: 2 * 60_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Node payment methods (CRUD for independent branch owners)
// ──────────────────────────────────────────────────────────────────────

export function useNodePaymentMethods() {
  return useQuery({
    queryKey: ['node-payment-methods'],
    queryFn: () =>
      apiGet<PaymentMethodsResponse>(
        '/tenant/branches/payment-methods',
      ),
    staleTime: 30_000,
  });
}

export function useCreateNodePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePaymentMethodPayload) =>
      apiPost<PaymentMethod>(
        '/tenant/branches/payment-methods',
        payload,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['node-payment-methods'] });
    },
  });
}

export function useUpdateNodePaymentMethod(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdatePaymentMethodPayload) => {
      if (!id) throw new Error('payment method id requerido');
      return apiPatch<PaymentMethod>(
        `/tenant/branches/payment-methods/${id}`,
        payload,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['node-payment-methods'] });
    },
  });
}

export function useArchiveNodePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      return apiPost<PaymentMethod>(
        `/tenant/branches/payment-methods/${id}/archive`,
        {},
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['node-payment-methods'] });
    },
  });
}
