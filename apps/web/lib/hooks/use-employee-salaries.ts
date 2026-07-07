/**
 * Hooks de sueldos por empleado (F1 · franquicia solo comercial del socio dep).
 *
 * El admin fija un sueldo mensual por cada empleado que un socio dependiente
 * creó. El motor de comisiones (F1) descuenta ese sueldo del NetWin del socio
 * dueño de la rama al momento del settle (ver /network-commissions).
 *
 * Acceso: admin_tenant only (el backend valida el rol inline). El frontend
 * también gatea la UI a admin para no mostrar un form que va a fallar con 403.
 *
 * Endpoints:
 *   - PUT /tenant/employees/:userId/salary   → upsert sueldo.
 *   - GET /tenant/employees/:userId/salary   → sueldo del user (404 si no tiene).
 *   - GET /tenant/employees/salaries         → lista paginada.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut, isApiError } from '../api-client';

export interface EmployeeSalary {
  userId: string;
  monthlyAmount: string;
  currency: string;
  updatedAt: string;
  updatedBy: string | null;
  notes: string | null;
}

export interface SalaryListRow {
  userId: string;
  username: string;
  displayName: string;
  monthlyAmount: string;
  currency: string;
  updatedAt: string;
  updatedBy: string | null;
  updatedByUsername: string | null;
  notes: string | null;
}

/**
 * Sueldo de un user. Devuelve `null` cuando el backend responde 404 (el user
 * no tiene sueldo configurado) — eso NO es un error, es el estado "sin sueldo".
 */
export function useEmployeeSalary(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['employee-salary', userId],
    enabled: !!userId && enabled,
    staleTime: 20_000,
    queryFn: async (): Promise<EmployeeSalary | null> => {
      try {
        const res = await apiGet<{ salary: EmployeeSalary }>(
          `/tenant/employees/${userId}/salary`,
        );
        return res.salary;
      } catch (err) {
        if (isApiError(err) && err.status === 404) return null;
        throw err;
      }
    },
  });
}

export function useSetEmployeeSalary(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { monthlyAmount: number; notes?: string | null }) =>
      apiPut<{ changed: boolean }>(
        `/tenant/employees/${userId}/salary`,
        payload,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-salary', userId] });
      qc.invalidateQueries({ queryKey: ['employee-salaries-list'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

export function useSalariesList(hasSalary = true) {
  return useQuery({
    queryKey: ['employee-salaries-list', hasSalary],
    staleTime: 20_000,
    queryFn: () =>
      apiGet<{ data: SalaryListRow[]; count: number; total: number }>(
        `/tenant/employees/salaries?hasSalary=${hasSalary}`,
      ),
  });
}
