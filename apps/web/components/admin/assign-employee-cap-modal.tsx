/**
 * AssignEmployeeCapModal — permite asignar el cupo mensual de correcciones
 * a un empleado eligiéndolo con búsqueda (docs/19).
 *
 * Complementa a EditCorrectionCapModal (que sirve para editar cupos EXISTENTES
 * mostrados en /tesoreria). Este modal es para arrancar: elegís un empleado
 * de la lista de usuarios activos + fijás su cupo. Sirve para dar cupo por
 * primera vez sin tener que entrar a la wallet del user.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ChipsAmountInput } from '@/components/ui/chips-amount-input';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import { UserSelect } from '@/components/ui/user-select';
import { isApiError } from '@/lib/api-client';
import { useSetCorrectionCap } from '@/lib/hooks/use-correction';
import type { TenantUserRow } from '@/lib/hooks/use-users';

const schema = z.object({
  cap: z
    .string()
    .min(1, 'Requerido.')
    .regex(/^\d+(?:\.\d{1,2})?$/, 'Cupo >= 0 con hasta 2 decimales.'),
});

type FormValues = z.infer<typeof schema>;

interface AssignEmployeeCapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignEmployeeCapModal({
  open,
  onOpenChange,
}: AssignEmployeeCapModalProps) {
  const setCap = useSetCorrectionCap();
  const [selectedUser, setSelectedUser] = useState<TenantUserRow | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { cap: '' },
  });

  useEffect(() => {
    if (!open) {
      setSelectedUser(null);
      reset();
    }
  }, [open, reset]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelectedUser(null);
      reset();
    }
    onOpenChange(next);
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!selectedUser) return;
    try {
      await setCap.mutateAsync({ userId: selectedUser.id, cap: values.cap });
      toast.success('Cupo asignado', {
        description: `${selectedUser.username}: ${fmt(values.cap)} fichas / mes.`,
      });
      handleOpenChange(false);
    } catch (err) {
      toast.error('No se pudo asignar el cupo', {
        description: mapError(err),
      });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Asignar cupo a un empleado"
      description="Fijá el techo mensual de cargas por corrección para un empleado. Al empleado le queda habilitado (necesita también el permiso wallet.correct)."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={setCap.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="assign-cap-form"
            disabled={setCap.isPending || !selectedUser}
          >
            {setCap.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Asignando…
              </>
            ) : (
              <>
                <UserPlus className="size-3.5" />
                Asignar cupo
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="assign-cap-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <span className="text-[12px] text-[var(--color-fg)] leading-snug">
            El empleado además necesita el permiso{' '}
            <strong>wallet.correct</strong>. Sin él, aunque le fijes cupo, no
            puede aplicar cargas. Se lo otorgás desde el editor de permisos del
            propio empleado.
          </span>
        </div>

        <FormField
          id="assign-user"
          label="Empleado"
          required
          hint="Buscá por nombre, username o email."
        >
          <UserSelect
            value={selectedUser}
            onSelect={setSelectedUser}
            placeholder="Buscar empleado…"
          />
        </FormField>

        <FormField
          id="assign-cap-amount"
          label="Cupo mensual"
          required
          error={errors.cap?.message}
          hint="En fichas. Ej: 50000 para $50k/mes."
        >
          <ChipsAmountInput
            id="assign-cap-amount"
            placeholder="0.00"
            invalid={!!errors.cap}
            {...register('cap')}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function fmt(x: string): string {
  const n = Number(x);
  return Number.isFinite(n)
    ? n.toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : x;
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso para asignar cupos.';
  if (err.status === 404) return 'Usuario no encontrado.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
