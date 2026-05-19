/**
 * GrantOverrideModal â€” otorgar override de permiso a un user.
 *
 * El backend valida:
 *   - permission_code existe en catÃ¡logo (400 sino).
 *   - is_delegatable=true (403 sino â€” no se pueden delegar permisos
 *     sensibles tipo wallet.adjust o users.impersonate).
 *   - regla de techo: actor debe tener el permiso (403 sino).
 *
 * UX:
 *   - Banner info: "el override se SUMA a los permisos del rol".
 *   - Select agrupado por category, MUESTRA solo delegables.
 *     Hint inferior cuando se selecciona uno: descripciÃ³n + audit_required.
 *   - Reason opcional (recomendado para auditabilidad).
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { isApiError } from '@/lib/api-client';
import {
  useGrantOverride,
  usePermissionsCatalog,
  type PermissionDef,
} from '@/lib/hooks/use-permissions';
import { type TenantUserRow } from '@/lib/hooks/use-users';

const schema = z.object({
  permissionCode: z.string().min(1, 'SeleccionÃ¡ un permiso.'),
  reason: z.string().max(500, 'MÃ¡ximo 500 caracteres.').optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface GrantOverrideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** User al que se le otorga el override. */
  targetUser: TenantUserRow | null;
  /** CÃ³digos de permisos que el user ya tiene como override 'grant' â€” los
   * filtramos del select para no permitir doble grant inÃºtil. */
  existingGrantedCodes?: string[];
}

export function GrantOverrideModal({
  open,
  onOpenChange,
  targetUser,
  existingGrantedCodes = [],
}: GrantOverrideModalProps) {
  const catalog = usePermissionsCatalog();
  const grant = useGrantOverride();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { permissionCode: '', reason: '' },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Filtrar a solo delegables que no tenga ya como override grant.
  const grouped = useMemo(() => {
    if (!catalog.data) return new Map<string, PermissionDef[]>();
    const all = catalog.data.data.filter(
      (p) => p.isDelegatable && !existingGrantedCodes.includes(p.code),
    );
    const map = new Map<string, PermissionDef[]>();
    for (const p of all) {
      const key = p.category ?? 'otros';
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [catalog.data, existingGrantedCodes]);

  const selectedCode = watch('permissionCode');
  const selectedDef = catalog.data?.data.find((p) => p.code === selectedCode);

  const handleSubmitForm = handleSubmit(async (values) => {
    if (!targetUser) {
      toast.error('Falta el user destinatario');
      return;
    }
    try {
      await grant.mutateAsync({
        userId: targetUser.id,
        permissionCode: values.permissionCode,
        reason: values.reason || undefined,
      });
      toast.success('Override otorgado', {
        description: `${values.permissionCode} â†’ ${targetUser.displayName || targetUser.username}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo otorgar', { description: mapError(err) });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Otorgar override"
      description={
        targetUser
          ? `Sumar un permiso individual a ${targetUser.displayName || targetUser.username}.`
          : 'Sumar un permiso individual.'
      }
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={grant.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="grant-override-form"
            disabled={grant.isPending}
          >
            {grant.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Otorgandoâ€¦
              </>
            ) : (
              <>
                <ShieldCheck className="size-3.5" />
                Otorgar
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="grant-override-form"
        onSubmit={handleSubmitForm}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <ShieldCheck className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
              Override 'grant'
            </span>
            <span className="text-[12px] text-[var(--color-fg)]">
              El permiso se SUMA a los del rol. Solo aparecen permisos
              delegables â€” los sensibles (wallet.adjust, users.impersonate)
              no se pueden otorgar via override.
            </span>
          </div>
        </div>

        <FormField
          id="go-permission"
          label="Permiso"
          required
          error={errors.permissionCode?.message}
          hint={
            selectedDef
              ? `${selectedDef.description ?? ''}${selectedDef.auditRequired ? ' Â· auditRequired' : ''}`
              : 'Agrupados por categorÃ­a. Solo delegables.'
          }
        >
          <Select
            id="go-permission"
            invalid={!!errors.permissionCode}
            disabled={catalog.isLoading}
            {...register('permissionCode')}
          >
            <option value="">â€” SeleccionÃ¡ â€”</option>
            {Array.from(grouped.entries()).map(([category, perms]) => (
              <optgroup key={category} label={category}>
                {perms.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </FormField>

        <FormField
          id="go-reason"
          label="Motivo"
          error={errors.reason?.message}
          hint="Opcional. Recomendado para auditabilidad."
        >
          <Input
            id="go-reason"
            type="text"
            invalid={!!errors.reason}
            placeholder="Ej: cajero promovido a supervisor temporal"
            {...register('reason')}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexiÃ³n.';
  if (err.status === 403) {
    if (typeof err.message === 'string' && err.message.includes('no es delegable')) {
      return 'Ese permiso no es delegable (sensitive).';
    }
    if (typeof err.message === 'string' && err.message.includes('no lo tenÃ©s')) {
      return 'No podÃ©s otorgar un permiso que vos mismo no tenÃ©s.';
    }
    return err.message || 'No tenÃ©s permiso para esta operaciÃ³n.';
  }
  if (err.status === 400) return err.message || 'Datos invÃ¡lidos.';
  return err.message || 'Error inesperado.';
}
