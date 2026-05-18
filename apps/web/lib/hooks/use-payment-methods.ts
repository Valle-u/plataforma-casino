/**
 * Hook de payment methods (catálogo del tenant).
 *
 * Endpoint: `GET /tenant/payment-methods?activeOnly=true`.
 * Cualquier user logueado puede leerlo — no requiere permission.
 *
 * MVP: solo read. CRUD admin pendiente para sprint futuro.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export type PaymentMethodType = 'bank_transfer' | 'crypto' | 'other';

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  type: PaymentMethodType;
  config: Record<string, unknown>;
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
