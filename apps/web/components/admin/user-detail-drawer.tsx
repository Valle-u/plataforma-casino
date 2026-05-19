/**
 * UserDetailDrawer â€” side panel con detalle del user + modo edit.
 *
 * Modos:
 *   - **view** (default): muestra perfil/roles/permisos read-only.
 *   - **edit**: muestra form para status/displayName/email/phone.
 *     Username + password NO son editables (cambian en otro flow:
 *     reset password, sumar role, etc.).
 *
 * UX:
 *   - "Editar" en footer cambia a modo edit.
 *   - "Cancelar" descarta cambios y vuelve a view.
 *   - "Guardar" llama mutation; on success muestra toast + vuelve a view.
 *
 * Cuando se cierra el drawer, siempre se resetea al modo view.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn, Pencil, Save, ShieldCheck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { USER_STATUSES } from '@/lib/constants';
import {
  useUpdateUser,
  useUserDetail,
  type TenantUserDetail,
} from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  banned: 'danger',
  suspended: 'warning',
  pending: 'neutral',
};

const editSchema = z.object({
  status: z.enum(['active', 'pending', 'suspended', 'banned']),
  displayName: z.string().min(1, 'Requerido.').max(100),
  email: z.string().email('Email invÃ¡lido.').optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
});

type EditValues = z.infer<typeof editSchema>;

interface UserDetailDrawerProps {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserDetailDrawer({
  userId,
  open,
  onOpenChange,
}: UserDetailDrawerProps) {
  const { data, isLoading, isError } = useUserDetail(userId);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [confirmImpersonate, setConfirmImpersonate] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const { user: actor, impersonate } = useAuth();
  const router = useRouter();

  // Resetear a modo view cada vez que cambia el user o se cierra el drawer.
  useEffect(() => {
    setMode('view');
  }, [userId, open]);

  const handleOpenChange = (next: boolean) => {
    setMode('view');
    onOpenChange(next);
  };

  // Sprint 37: el botÃ³n impersonate se muestra solo si:
  //   - El actor es distinto del target (no self).
  //   - El actor NO estÃ¡ ya impersonando (no chain).
  // El backend valida permission `users.impersonate` (403 si falla).
  const canImpersonate =
    !!data &&
    !!actor &&
    actor.id !== data.user.id &&
    !actor.impersonatedBy;

  async function handleImpersonate(): Promise<void> {
    if (!data) return;
    setImpersonating(true);
    try {
      await impersonate(data.user.id);
      toast.success(
        `Ahora operÃ¡s como @${data.user.username}. El banner arriba te deja volver.`,
      );
      setConfirmImpersonate(false);
      handleOpenChange(false);
      // Redirect a /play para que el admin "vea lo que ve el user".
      // Si el target tiene rol admin/cajero/etc., el routing del player
      // protegido le harÃ¡ revertir solo, pero el escenario tÃ­pico es
      // impersonar un usuario_final para debugging.
      router.replace('/play');
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        toast.error('No tenÃ©s permiso users.impersonate.');
      } else if (isApiError(err)) {
        toast.error(err.message || 'No se pudo impersonate.');
      } else {
        toast.error('Error de conexiÃ³n.');
      }
    } finally {
      setImpersonating(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      title={data?.user.displayName ?? data?.user.username ?? 'Cargandoâ€¦'}
      subtitle={
        data ? `@${data.user.username}` : userId ? userId.slice(0, 13) + 'â€¦' : ''
      }
      footer={
        data && mode === 'view' ? (
          <>
            <Button variant="ghost" size="md" asChild>
              <Link href={`/users/${data.user.id}/wallet`}>
                <Wallet className="size-3.5" />
                Ver wallet
              </Link>
            </Button>
            {canImpersonate && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => setConfirmImpersonate(true)}
                title="Operar como este usuario (audit severity:high)"
              >
                <LogIn className="size-3.5" />
                Impersonate
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="secondary" size="md" onClick={() => handleOpenChange(false)}>
              Cerrar
            </Button>
            <Button variant="primary" size="md" onClick={() => setMode('edit')}>
              <Pencil className="size-3.5" />
              Editar
            </Button>
          </>
        ) : null
      }
    >
      {isLoading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-32 w-full bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-48 w-full bg-[var(--color-bg-subtle)]" />
        </div>
      )}
      {isError && (
        <EmptyState
          hint="user_detail"
          label="No se pudo cargar el detalle del usuario."
        />
      )}
      {data && mode === 'view' && <ViewMode data={data} />}
      {data && mode === 'edit' && (
        <EditMode
          data={data}
          userId={data.user.id}
          onCancel={() => setMode('view')}
          onSaved={() => setMode('view')}
        />
      )}
      {data && (
        <ConfirmModal
          open={confirmImpersonate}
          onOpenChange={setConfirmImpersonate}
          title={`Â¿Impersonate a @${data.user.username}?`}
          description="Vas a operar como este usuario hasta que vuelvas atrÃ¡s. Cada acciÃ³n durante la impersonaciÃ³n queda auditada con tu id como impersonator."
          warning="Severidad alta: el audit log registra la operaciÃ³n. Usalo solo para soporte / debug."
          confirmLabel="Impersonate"
          confirmIcon={<LogIn className="size-3.5" />}
          confirmVariant="outline-accent"
          onConfirm={handleImpersonate}
          isPending={impersonating}
        />
      )}
    </Drawer>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// View mode
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ViewMode({ data }: { data: TenantUserDetail }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Perfil */}
      <section className="flex flex-col gap-3">
        <SectionHeader label="Perfil" />
        <DetailRow label="Email" value={data.user.email ?? 'â€”'} mono />
        <DetailRow label="TelÃ©fono" value={data.user.phone ?? 'â€”'} mono />
        <DetailRow
          label="Estado"
          valueNode={
            <Badge variant={STATUS_VARIANT[data.user.status] ?? 'neutral'} dot>
              {data.user.status}
            </Badge>
          }
        />
        <DetailRow
          label="2FA"
          valueNode={
            data.user.twoFaEnabled ? (
              <Badge variant="success" dot>
                Activo
              </Badge>
            ) : (
              <Badge variant="neutral">Inactivo</Badge>
            )
          }
        />
        <DetailRow label="Creado" value={formatDate(data.user.createdAt)} mono />
      </section>

      {/* Roles */}
      <section className="flex flex-col gap-3">
        <SectionHeader label={`Roles (${data.roles.length})`} />
        <div className="flex flex-wrap gap-1.5">
          {data.roles.length === 0 ? (
            <span className="text-[12px] text-[var(--color-fg-subtle)] italic">
              Sin roles asignados
            </span>
          ) : (
            data.roles.map((r) => (
              <Badge key={r.code} variant={r.isSystem ? 'danger' : 'neutral'}>
                {r.code}
              </Badge>
            ))
          )}
        </div>
      </section>

      {/* Permisos efectivos */}
      <section className="flex flex-col gap-3">
        <SectionHeader
          label={`Permisos efectivos (${data.effectivePermissions.length})`}
          icon={<ShieldCheck className="size-3 text-[var(--color-accent-text)]" />}
        />
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] max-h-[280px] overflow-y-auto">
          {data.effectivePermissions.length === 0 ? (
            <div className="p-3 text-[12px] text-[var(--color-fg-subtle)] italic">
              Sin permisos
            </div>
          ) : (
            <ul className="flex flex-col">
              {data.effectivePermissions.map((perm) => (
                <li
                  key={perm}
                  className="px-3 py-1.5 text-[12px] font-mono text-[var(--color-fg-muted)] border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-subtle)] transition-colors"
                >
                  {perm}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Edit mode
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EditMode({
  data,
  userId,
  onCancel,
  onSaved,
}: {
  data: TenantUserDetail;
  userId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const update = useUpdateUser(userId);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      status: (data.user.status as EditValues['status']) ?? 'active',
      displayName: data.user.displayName,
      email: data.user.email ?? '',
      phone: data.user.phone ?? '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        status: values.status,
        displayName: values.displayName,
        email: values.email || null,
        phone: values.phone || null,
      });
      toast.success('Cambios guardados', {
        description: `${data.user.username} fue actualizado.`,
      });
      onSaved();
    } catch (err) {
      const msg = mapServerError(err);
      toast.error('No se pudo guardar', { description: msg });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <SectionHeader label="Editar perfil" />

      <FormField
        id="ed-status"
        label="Estado"
        required
        error={errors.status?.message}
      >
        <Select
          id="ed-status"
          invalid={!!errors.status}
          {...register('status')}
        >
          {USER_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        id="ed-displayName"
        label="Nombre visible"
        required
        error={errors.displayName?.message}
      >
        <Input
          id="ed-displayName"
          type="text"
          invalid={!!errors.displayName}
          {...register('displayName')}
        />
      </FormField>

      <FormField id="ed-email" label="Email" error={errors.email?.message}>
        <Input
          id="ed-email"
          type="email"
          invalid={!!errors.email}
          {...register('email')}
        />
      </FormField>

      <FormField id="ed-phone" label="TelÃ©fono" error={errors.phone?.message}>
        <Input
          id="ed-phone"
          type="tel"
          invalid={!!errors.phone}
          {...register('phone')}
        />
      </FormField>

      {/* Footer inline (el Drawer footer estÃ¡ oculto en mode edit) */}
      <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onCancel}
          disabled={update.isPending}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={update.isPending || !isDirty}
        >
          {update.isPending ? (
            <>
              <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
              Guardandoâ€¦
            </>
          ) : (
            <>
              <Save className="size-3.5" />
              Guardar cambios
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function SectionHeader({
  label,
  icon,
}: {
  label: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 pb-2 border-b border-[var(--color-border)]">
      {icon}
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
        {label}
      </span>
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueNode,
  mono,
}: {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {valueNode ?? (
        <span
          className={cn(
            'text-[13px] text-[var(--color-fg)]',
            mono && 'font-mono',
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function mapServerError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexiÃ³n.';
  if (err.status === 409) return 'El email ya estÃ¡ en uso por otro usuario.';
  if (err.status === 404) return 'Usuario no encontrado.';
  if (err.status === 403) return 'No tenÃ©s permiso para editar este usuario.';
  if (err.status === 400) return err.message || 'Datos invÃ¡lidos.';
  return err.message || 'Error inesperado.';
}
