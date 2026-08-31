/**
 * Cuentas bancarias PROPIAS del tenant.
 *
 *   GET   /tenant/bank-accounts[?includeInactive=true]
 *   POST  /tenant/bank-accounts
 *   PATCH /tenant/bank-accounts/:id
 *   POST  /tenant/bank-accounts/:id/active
 *
 * Se definen una vez acá y el formulario de transferencias las elige de una
 * lista, en vez de aceptar el titular y el banco como texto libre — que es como
 * terminó un tercero cargado en el campo de nuestra propia cuenta.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';

export interface BankAccount {
  id: string;
  /** Nombre corto para reconocerla en el selector. */
  label: string;
  accountHolder: string;
  bankName: string;
  /** CBU / alias / código interno. Distingue dos cuentas del mismo banco. */
  accountIdentifier: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBankAccountInput {
  label: string;
  accountHolder: string;
  bankName: string;
  accountIdentifier?: string;
}

const KEY = ['bank-accounts'];

/**
 * @param includeInactive las dadas de baja también. El selector del formulario
 *   NO las quiere (no se puede operar con una cuenta cerrada); el panel de
 *   administración sí, para poder reactivarlas.
 */
export function useBankAccounts(includeInactive = false) {
  return useQuery<{ data: BankAccount[] }>({
    queryKey: [...KEY, includeInactive],
    queryFn: () =>
      apiGet(
        `/tenant/bank-accounts${includeInactive ? '?includeInactive=true' : ''}`,
      ),
    staleTime: 30_000,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: KEY });
}

export function useCreateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertBankAccountInput) =>
      apiPost<BankAccount>('/tenant/bank-accounts', input),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: Partial<UpsertBankAccountInput> & { id: string }) =>
      apiPatch<BankAccount>(`/tenant/bank-accounts/${id}`, input),
    onSuccess: () => invalidate(qc),
  });
}

/** Baja / alta LÓGICA. No hay borrado: las transferencias viejas la referencian. */
export function useSetBankAccountActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiPost<BankAccount>(`/tenant/bank-accounts/${id}/active`, { isActive }),
    onSuccess: () => invalidate(qc),
  });
}
