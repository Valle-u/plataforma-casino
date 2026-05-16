/**
 * RevokeOverrideModal — revocar EXPLÍCITAMENTE un permiso a un user.
 *
 * Diferencia con "clear":
 *   - revoke: inserta override 'revoke' (NEGACIÓN explícita). Aunque el rol
 *     diga sí, el user NO lo tiene. Reason obligatorio.
 *   - clear: borra el override existente. El user vuelve a depender de su
 *     rol (que puede tener o no tener el permiso).
 *
 * Cascada: si el user tiene downstream (gente a la que él le dio override),
 * el revoke barre todos esos downstream. Mostramos preview ANTES de
 * confirmar para que el admin sepa el blast radius.
 *
 * UX:
 *   - Banner warning (acción destructiva).
 *   - Permission select: TODOS los del catálogo (incluye no-delegables —
 *     se puede revocar lo que no se puede otorgar).
 *   - Cascade preview live cuando hay permission seleccionado.
 *   - Reason obligatorio (min 3 chars), counter N/500.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Ban } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { isApiError } from '@/lib/api-client';
import {
  useCascadePreview,
  usePermissionsCatalog,
  useRevokeOverride,
  type PermissionDef,
} from '@/lib/hooks/use-permissions';
import { type TenantUserRow } from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';

const schema = z.object({
  permissionCode: z.string().min(1, 'Seleccioná un permiso.'),
  reason: z
    .string()
    .min(3, 'Mínimo 3 caracteres.')
    .max(500, 'Máximo 500 caracteres.'),
});

type FormValues = z.infer<typeof schema>;

interface RevokeOverrideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUser: TenantUserRow | null;
  /** Si está, pre-selecciona el permiso a revocar (lock). Caso: revoke
   * desde la fila de un override existente en la tabla. */
  presetPermissionCode?: string | null;
}

export function RevokeOverrideModal({
  open,
  onOpenChange,
  targetUser,
  presetPermissionCode,
}: RevokeOverrideModalProps) {
  const catalog = usePermissionsCatalog();
  const revoke = useRevokeOverride();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { permissionCode: '', reason: '' },
  });

  // Reset al cerrar.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Aplicar preset al abrir.
  useEffect(() => {
    if (open && presetPermissionCode) {
      setValue('permissionCode', presetPermissionCode);
    }
  }, [open, presetPermissionCode, setValue]);

  const grouped = useMemo(() => {
    if (!catalog.data) return new Map<string, PermissionDef[]>();
    const map = new Map<string, PermissionDef[]>();
    for (const p of catalog.data.data) {
      const key = p.category ?? 'otros';
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [catalog.data]);

  const selectedCode = watch('permissionCode');
  const reasonValue = watch('reason') ?? '';
  const selectedDef = catalog.data?.data.find((p) => p.code === selectedCode);

  // Cascade preview live (deshabilitado si no hay permission).
  const cascade = useCascadePreview(
    targetUser?.id ?? null,
    selectedCode || null,
  );

  const onSubmit = handleSubmit(async (values) => {
    if (!targetUser) {
      toast.error('Falta el user destinatario');
      return;
    }
    try {
      const res = await revoke.mutateAsync({
        userId: targetUser.id,
        permissionCode: values.permissionCode,
        reason: values.reason,
      });
      toast.success('Override revocado', {
        description:
          res.cascadedCount > 0
            ? `${values.permissionCode} · ${res.cascadedCount} downstream barridos`
            : `${values.permissionCode} revocado`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo revocar', { description: mapError(err) });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Revocar permiso"
      description={
        targetUser
          ? `Negar explícitamente un permiso a ${targetUser.displayName || targetUser.username}.`
          : 'Negar explícitamente un permiso.'
      }
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={revoke.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="md"
            type="submit"
            form="revoke-override-form"
            disabled={revoke.isPending}
          >
            {revoke.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Revocando…
              </>
            ) : (
              <>
                <Ban className="size-3.5" />
                Revocar
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="revoke-override-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
          <AlertTriangle className="size-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent)] font-medium">
              Override 'revoke' — destructivo
            </span>
            <span className="text-[12px] text-[var(--color-fg)]">
              Aunque el rol del user diga sí, este override NIEGA el permiso.
              Si tiene downstream, también se borran (cascada).
            </span>
          </div>
        </div>

        <FormField
          id="ro-permission"
          label="Permiso"
          required
          error={errors.permissionCode?.message}
          hint={
            selectedDef
              ? `${selectedDef.description ?? ''}${!selectedDef.isDelegatable ? ' · sensible' : ''}`
              : 'Cualquier permiso del catálogo.'
          }
        >
          <Select
            id="ro-permission"
            invalid={!!errors.permissionCode}
            disabled={catalog.isLoading || !!presetPermissionCode}
            {...register('permissionCode')}
          >
            <option value="">— Seleccioná —</option>
            {Array.from(grouped.entries()).map(([category, perms]) => (
              <optgroup key={category} label={category}>
                {perms.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code}
                    {!p.isDelegatable ? ' (sensible)' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </FormField>

        {/* Cascade preview */}
        {selectedCode && (
          <CascadePreviewBox
            isLoading={cascade.isLoading}
            count={cascade.data?.count ?? 0}
            affected={cascade.data?.affected ?? []}
          />
        )}

        <FormField
          id="ro-reason"
          label="Motivo"
          required
          error={errors.reason?.message}
          hint="Mínimo 3 caracteres. Queda en audit log."
        >
          <textarea
            id="ro-reason"
            rows={3}
            aria-invalid={!!errors.reason}
            placeholder="Ej: cajero perdió la confianza, no debe poder cargar wallets"
            className={cn(
              'flex w-full px-3 py-2 resize-none',
              'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
              'border border-[var(--color-border)]',
              'placeholder:text-[var(--color-fg-subtle)]',
              'text-[13px] leading-relaxed',
              'transition-[border-color,box-shadow] duration-150',
              'hover:border-[var(--color-border-strong)]',
              'focus:outline-none focus:border-[var(--color-accent)]',
              'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
              'aria-invalid:border-[var(--color-accent)]',
              'aria-invalid:shadow-[0_0_0_3px_var(--color-accent-glow)]',
            )}
            {...register('reason')}
          />
          <div className="flex justify-end">
            <span
              className={cn(
                'text-[10px] font-mono tabular-nums',
                reasonValue.length > 450
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-fg-subtle)]',
              )}
            >
              {reasonValue.length}/500
            </span>
          </div>
        </FormField>
      </form>
    </Modal>
  );
}

function CascadePreviewBox({
  isLoading,
  count,
  affected,
}: {
  isLoading: boolean;
  count: number;
  affected: Array<{ userId: string; effect: 'grant' | 'revoke' }>;
}) {
  if (isLoading) {
    return (
      <div className="px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[12px] text-[var(--color-fg-subtle)]">
        Calculando blast radius…
      </div>
    );
  }
  if (count === 0) {
    return (
      <div className="px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[12px] text-[var(--color-fg-muted)]">
        Sin downstream — la cascada no afecta a otros users.
      </div>
    );
  }
  return (
    <div className="px-3 py-2.5 border border-[var(--color-warning)] bg-[var(--color-warning-bg)] flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-3.5 text-[var(--color-warning)]" />
        <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-warning)] font-medium">
          Cascada · {count} downstream
        </span>
      </div>
      <div className="text-[11px] text-[var(--color-fg)]">
        Se barrerán {count} override(s) que dependen de esta delegación.
      </div>
      <ul className="text-[10px] font-mono text-[var(--color-fg-muted)] flex flex-col gap-0.5 max-h-[120px] overflow-y-auto">
        {affected.slice(0, 10).map((a, i) => (
          <li key={`${a.userId}-${i}`} className="truncate">
            {a.userId.slice(0, 13)}… ({a.effect})
          </li>
        ))}
        {affected.length > 10 && (
          <li className="text-[var(--color-fg-subtle)] italic">
            +{affected.length - 10} más…
          </li>
        )}
      </ul>
    </div>
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return err.message || 'No tenés permiso para esta operación.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
