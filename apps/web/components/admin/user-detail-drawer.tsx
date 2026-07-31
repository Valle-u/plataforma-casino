/**
 * UserDetailDrawer — side panel con detalle del user + modo edit.
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
import { Banknote, Building2, Coins, Gift, KeyRound, LogIn, Pencil, Power, Save, ShieldCheck, Wallet } from 'lucide-react';
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
import { GrantBonusModal } from '@/components/admin/grant-bonus-modal';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import { useAuth, isAdminTenant, hasPermission } from '@/lib/auth-context';
import { USER_STATUSES } from '@/lib/constants';
import {
  useEmployeeSalary,
  useSetEmployeeSalary,
} from '@/lib/hooks/use-employee-salaries';
import {
  useUpdateUser,
  useUserDetail,
  type TenantUserDetail,
  type TenantUserRow,
} from '@/lib/hooks/use-users';
import {
  useSellBranchChips,
  useToggleBranchIndependence,
} from '@/lib/hooks/use-branches';
import { ResetPasswordModal } from '@/components/admin/reset-password-modal';
import { RiskBadge } from '@/components/admin/permission-info';
import { getPermissionMeta } from '@/lib/permission-meta';
import { cn } from '@/lib/cn';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  banned: 'danger',
  suspended: 'warning',
  pending: 'neutral',
};

/**
 * F1: roles que cobran sueldo (el motor de comisiones los descuenta del NetWin
 * del socio dueño de la rama). Debe coincidir con `SALARIED_ROLES` del backend
 * (network-commissions.service.ts).
 */
const SALARIED_ROLE_CODES = ['cajero', 'distribuidor', 'empleado'];

const editSchema = z.object({
  status: z.enum(['active', 'pending', 'suspended', 'banned']),
  displayName: z.string().min(1, 'Requerido.').max(100),
  email: z.string().email('Email inválido.').optional().or(z.literal('')),
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
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [grantBonusOpen, setGrantBonusOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [interveneReason, setInterveneReason] = useState('');
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

  // Sprint 37: el botón impersonate se muestra solo si:
  //   - El actor es distinto del target (no self).
  //   - El actor NO está ya impersonando (no chain).
  // El backend valida permission `users.impersonate` (403 si falla).
  const canImpersonate =
    !!data &&
    !!actor &&
    actor.id !== data.user.id &&
    !actor.impersonatedBy;

  // Sprint 51.4: botón "Resetear password" — visible si el actor NO es
  // el target. El backend rechaza con 403 si no está en su downstream
  // o si no tiene `users.reset_password` (rol socio/distrib/cajero/admin).
  // Mostramos el botón sin chequear permisos en el cliente — si falla,
  // el toast del modal lo explica.
  const canResetPassword =
    !!data && !!actor && actor.id !== data.user.id;

  const isIndependentTarget = !!data?.user.isIndependentBranch;

  // 2026-07: el botón "Otorgar bono" se muestra solo a quien tiene el
  // permiso efectivo `bonuses.grant_manual` (admin, socio indep, o
  // cajero/distribuidor de sub-red independiente — LEYES R3/R4) Y el
  // target es usuario final (la wallet de bonos es solo de jugadores).
  const canGrantBonus =
    !!data &&
    hasPermission(actor, 'bonuses.grant_manual') &&
    data.roles.some((r) => r.code === 'usuario_final');

  async function handleImpersonate(): Promise<void> {
    if (!data) return;
    // Si el target es independiente, exigir motivo.
    if (isIndependentTarget && !interveneReason.trim()) {
      toast.error('Debés escribir un motivo para intervenir una sub-red independiente.');
      return;
    }
    setImpersonating(true);
    try {
      const target = await impersonate(
        data.user.id,
        isIndependentTarget ? interveneReason.trim() : undefined,
      );
      toast.success(
        `Ahora operás como @${data.user.username}. El banner arriba te deja volver.`,
      );
      setConfirmImpersonate(false);
      handleOpenChange(false);
      // Redirect según el rol del target: si puede acceder al panel
      // (socio/distribuidor/cajero/admin) lo mandamos al panel; si es
      // jugador (usuario_final) a /play para "ver lo que ve el user".
      router.replace(target.canAccessPanel ? '/dashboard' : '/play');
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        toast.error('No tenés permiso users.impersonate.');
      } else if (isApiError(err)) {
        toast.error(err.message || 'No se pudo impersonate.');
      } else {
        toast.error('Error de conexión.');
      }
    } finally {
      setImpersonating(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      title={data?.user.displayName ?? data?.user.username ?? 'Cargando…'}
      subtitle={
        data ? `@${data.user.username}` : userId ? userId.slice(0, 13) + '…' : ''
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
            {canGrantBonus && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => setGrantBonusOpen(true)}
                title="Otorgar bono al usuario"
              >
                <Gift className="size-3.5" />
                Otorgar bono
              </Button>
            )}
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
            {canResetPassword && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => setResetPasswordOpen(true)}
                title="Resetear la password de este usuario (audit severity:high)"
              >
                <KeyRound className="size-3.5" />
                Resetear password
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
          onOpenChange={(open) => {
            setConfirmImpersonate(open);
            if (!open) setInterveneReason('');
          }}
          title={`¿Impersonate a @${data.user.username}?`}
          description="Vas a operar como este usuario hasta que vuelvas atrás. Cada acción durante la impersonación queda auditada con tu id como impersonator."
          warning={
            isIndependentTarget
              ? 'Intervención en sub-red independiente: severidad CRITICAL. Escribí el motivo de la intervención.'
              : 'Severidad alta: el audit log registra la operación. Usalo solo para soporte / debug.'
          }
          confirmLabel="Impersonate"
          confirmIcon={<LogIn className="size-3.5" />}
          confirmVariant="outline-accent"
          onConfirm={handleImpersonate}
          isPending={impersonating}
        >
          {isIndependentTarget && (
            <div className="flex flex-col gap-1.5 mt-3">
              <label className="text-[12px] font-medium text-[var(--color-fg)]">
                Motivo de la intervención *
              </label>
              <textarea
                value={interveneReason}
                onChange={(e) => setInterveneReason(e.target.value)}
                placeholder="Ej: Soporte técnico — verificar config de rama..."
                rows={2}
                className="w-full px-3 py-2 text-[13px] bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
              />
            </div>
          )}
        </ConfirmModal>
      )}
      {data && (
        <ResetPasswordModal
          open={resetPasswordOpen}
          onOpenChange={setResetPasswordOpen}
          targetUserId={data.user.id}
          targetUsername={data.user.username}
          targetDisplayName={data.user.displayName}
          actorHasTwoFa={!!actor?.twoFaEnabled}
        />
      )}
      {data && (
        <GrantBonusModal
          open={grantBonusOpen}
          onOpenChange={setGrantBonusOpen}
          actorUserId={actor?.id ?? ''}
          presetTargetUser={{ id: data.user.id, username: data.user.username, displayName: data.user.displayName } as TenantUserRow}
        />
      )}
    </Drawer>
  );
}

// ──────────────────────────────────────────────────────────────────────
// View mode
// ──────────────────────────────────────────────────────────────────────

function ViewMode({ data }: { data: TenantUserDetail }) {
  const { user: actor } = useAuth();
  // F1: la sección de sueldo es admin-only (endpoints admin_tenant) y solo
  // aplica a roles salariados. Para el resto, ni la mostramos.
  const showSalary =
    isAdminTenant(actor) &&
    data.roles.some((r) => SALARIED_ROLE_CODES.includes(r.code));

  return (
    <div className="flex flex-col gap-6">
      {/* Perfil */}
      <section className="flex flex-col gap-3">
        <SectionHeader label="Perfil" />
        <DetailRow label="Email" value={data.user.email ?? '—'} mono />
        <DetailRow label="Teléfono" value={data.user.phone ?? '—'} mono />
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
              {data.effectivePermissions.map((perm) => {
                const meta = getPermissionMeta(perm);
                return (
                  <li
                    key={perm}
                    className="px-3 py-1.5 flex items-center gap-2 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-subtle)] transition-colors"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-[12px] text-[var(--color-fg)] truncate">
                        {meta.label}
                      </span>
                      <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] truncate">
                        {perm}
                      </span>
                    </div>
                    {meta.risk === 'high' && (
                      <RiskBadge risk="high" className="ml-auto" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Sprint 51: Sección Sucursal — visible solo para socios. */}
      {data.roles.some((r) => r.code === 'socio') && (
        <BranchSection data={data} />
      )}

      {/* F1: Sección Sueldo — admin-only, roles salariados. */}
      {showSalary && <SalarySection userId={data.user.id} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit mode
// ──────────────────────────────────────────────────────────────────────

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

      <FormField id="ed-phone" label="Teléfono" error={errors.phone?.message}>
        <Input
          id="ed-phone"
          type="tel"
          invalid={!!errors.phone}
          {...register('phone')}
        />
      </FormField>

      {/* Footer inline (el Drawer footer está oculto en mode edit) */}
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
              Guardando…
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

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

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
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) return 'El email ya está en uso por otro usuario.';
  if (err.status === 404) return 'Usuario no encontrado.';
  if (err.status === 403) return 'No tenés permiso para editar este usuario.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51: BranchSection — toggle independent + config + sell chips
// Visible solo para socios. Admin-only operations (los buttons fallan
// 403 si el actor no tiene `branch.toggle_independence` / `branch.sell_chips`).
// ──────────────────────────────────────────────────────────────────────

function BranchSection({ data }: { data: TenantUserDetail }) {
  const socioId = data.user.id;
  const isIndependent = !!data.user.isIndependentBranch;
  const toggle = useToggleBranchIndependence(socioId);
  const sell = useSellBranchChips(socioId);

  // Form local: campos de config + amount para venta.
  const [bankAccount, setBankAccount] = useState(
    data.user.branchBankAccount ?? '',
  );
  const [price, setPrice] = useState(data.user.branchChipsPricePerUnit ?? '1.0000');
  const [sellAmount, setSellAmount] = useState('');
  const [sellFiat, setSellFiat] = useState('');
  const [sellNotes, setSellNotes] = useState('');
  // D3: confirmación del flip (cambio de modo reconciliado). null = cerrado.
  const [flipConfirm, setFlipConfirm] = useState<
    'activate' | 'deactivate' | null
  >(null);

  // Sincronizar con cambios server-side (otro admin tocó la config).
  useEffect(() => {
    setBankAccount(data.user.branchBankAccount ?? '');
    setPrice(data.user.branchChipsPricePerUnit ?? '1.0000');
  }, [data.user.branchBankAccount, data.user.branchChipsPricePerUnit]);

  const handleActivate = async (): Promise<void> => {
    if (!bankAccount.trim()) {
      toast.error('Cargá el CBU/alias del banco propio del socio.');
      return;
    }
    if (Number(price) <= 0) {
      toast.error('El precio mayorista debe ser > 0.');
      return;
    }
    try {
      await toggle.mutateAsync({
        isIndependent: true,
        branchBankAccount: bankAccount.trim(),
        branchChipsPricePerUnit: price,
      });
      toast.success('Sucursal activada', {
        description: `@${data.user.username} ahora opera como independent.`,
      });
      setFlipConfirm(null);
    } catch (err) {
      toast.error('No se pudo activar', { description: mapBranchError(err) });
    }
  };

  const handleDeactivate = async (): Promise<void> => {
    try {
      await toggle.mutateAsync({ isIndependent: false });
      toast.success('Sucursal desactivada', {
        description: 'El socio vuelve a operar contra el banco del tenant.',
      });
      setFlipConfirm(null);
    } catch (err) {
      toast.error('No se pudo desactivar', { description: mapBranchError(err) });
    }
  };

  const handleSell = async (): Promise<void> => {
    if (!sellAmount || Number(sellAmount) <= 0) {
      toast.error('Cargá el monto de fichas a vender.');
      return;
    }
    if (sellFiat && Number(sellFiat) <= 0) {
      toast.error('El total $ debe ser > 0.');
      return;
    }
    try {
      const result = await sell.mutateAsync({
        amountChips: sellAmount,
        amountFiat: sellFiat || undefined,
        notes: sellNotes || undefined,
      });
      toast.success('Fichas vendidas', {
        description: `${result.amountChips} fichas → $${result.amountFiat} (precio ${result.pricePerUnit}). Nuevo balance: ${result.newBalance}.`,
      });
      setSellAmount('');
      setSellFiat('');
      setSellNotes('');
    } catch (err) {
      toast.error('No se pudo vender', { description: mapBranchError(err) });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        label="Sucursal independiente"
        icon={<Building2 className="size-3 text-[var(--color-accent-text)]" />}
      />

      {/* Estado actual */}
      <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
            Modo
          </span>
          <span className="text-[13px] text-[var(--color-fg)]">
            {isIndependent ? 'Independiente' : 'Dependiente (default)'}
          </span>
        </div>
        <Badge variant={isIndependent ? 'info' : 'neutral'} dot>
          {isIndependent ? 'INDEPENDENT' : 'DEPENDENT'}
        </Badge>
      </div>

      {/* Config form */}
      <div className="flex flex-col gap-2.5 p-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
          Config
        </span>
        <FormField id="br-bank" label="CBU/alias del banco propio">
          <Input
            id="br-bank"
            value={bankAccount}
            onChange={(e) => setBankAccount(e.target.value)}
            placeholder="CBU o alias"
            disabled={toggle.isPending}
            className="font-mono"
          />
        </FormField>
        <FormField
          id="br-price"
          label="Precio mayorista (por ficha)"
          hint="Ej: 1.0000 = paridad, 0.9500 = 5% descuento al socio."
        >
          <Input
            id="br-price"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="1.0000"
            disabled={toggle.isPending}
            className="font-mono"
          />
        </FormField>
        <div className="flex justify-end gap-2 pt-1">
          {isIndependent ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setFlipConfirm('deactivate')}
                disabled={toggle.isPending}
              >
                <Power className="size-3" />
                Desactivar
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleActivate}
                disabled={toggle.isPending}
              >
                <Save className="size-3" />
                Guardar config
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setFlipConfirm('activate')}
              disabled={toggle.isPending}
            >
              <Power className="size-3" />
              Activar como independiente
            </Button>
          )}
        </div>
      </div>

      {/* Sell chips — solo si está independent */}
      {isIndependent && (
        <div className="flex flex-col gap-2.5 p-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
            Vender fichas
          </span>
          <FormField
            id="br-sell-amount"
            label="Fichas"
            hint={
              price && Number(price) > 0 && sellAmount && Number(sellAmount) > 0
                ? `Al precio configurado (${Number(price).toFixed(4)}/ficha) serían $${(Number(sellAmount) * Number(price)).toFixed(2)}.`
                : 'El total $ se carga abajo; el precio/ficha se calcula solo.'
            }
          >
            <Input
              id="br-sell-amount"
              value={sellAmount}
              onChange={(e) =>
                setSellAmount(e.target.value.replace(/[^0-9.]/g, ''))
              }
              placeholder="0"
              disabled={sell.isPending}
              className="font-mono"
            />
          </FormField>
          <FormField
            id="br-sell-fiat"
            label="Total $ a cobrar"
            hint="Cuánto le cobrás por esta venta. Vacío → usa el precio configurado."
          >
            <Input
              id="br-sell-fiat"
              value={sellFiat}
              onChange={(e) =>
                setSellFiat(e.target.value.replace(/[^0-9.]/g, ''))
              }
              placeholder="0.00"
              disabled={sell.isPending}
              className="font-mono"
            />
          </FormField>
          {sellAmount &&
            Number(sellAmount) > 0 &&
            sellFiat &&
            Number(sellFiat) > 0 && (
              <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
                Precio por ficha: $
                {(Number(sellFiat) / Number(sellAmount)).toFixed(4)}
              </span>
            )}
          <FormField id="br-sell-notes" label="Notas (opcional)">
            <Input
              id="br-sell-notes"
              value={sellNotes}
              onChange={(e) => setSellNotes(e.target.value)}
              placeholder="ej. venta semanal viernes"
              disabled={sell.isPending}
              maxLength={500}
            />
          </FormField>
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSell}
              disabled={sell.isPending || !sellAmount}
            >
              <Coins className="size-3" />
              {sell.isPending ? 'Vendiendo…' : 'Vender fichas'}
            </Button>
          </div>
        </div>
      )}

      {/* D3: confirmación del flip reconciliado — explica los efectos antes de
          ejecutar. El cambio de modo mueve fichas, permisos y comisión. */}
      {flipConfirm && (
        <ConfirmModal
          open={flipConfirm !== null}
          onOpenChange={(o) => {
            if (!o) setFlipConfirm(null);
          }}
          title={
            flipConfirm === 'activate'
              ? 'Activar sucursal independiente'
              : 'Volver a dependiente'
          }
          description={
            flipConfirm === 'activate'
              ? `@${data.user.username} pasa a bancar su propia red. El cambio reconcilia fichas, permisos, visibilidad y comisión en una sola operación.`
              : `@${data.user.username} vuelve a ser comercial puro (lo banca la Casa). El cambio reconcilia todo en una sola operación.`
          }
          warning={
            flipConfirm === 'activate'
              ? 'El socio COMPRA el saldo en circulación de su red a la Casa (paga el stock). Se bloquea si la Casa no tiene stock suficiente o si hay depósitos/retiros pendientes en su red.'
              : 'El stock propio sin vender del socio SE QUEMA sin reintegro. Se bloquea si hay depósitos/retiros pendientes, transferencias sin conciliar, bonos activos o fraude sin resolver.'
          }
          confirmLabel={
            flipConfirm === 'activate'
              ? 'Activar independiente'
              : 'Degradar a dependiente'
          }
          confirmVariant={flipConfirm === 'activate' ? 'primary' : 'danger'}
          confirmIcon={<Power className="size-3.5" />}
          onConfirm={
            flipConfirm === 'activate' ? handleActivate : handleDeactivate
          }
          isPending={toggle.isPending}
        >
          <ul className="flex flex-col gap-1.5 text-[12px] text-[var(--color-fg-muted)] mt-1">
            {(flipConfirm === 'activate'
              ? [
                  'Compra el saldo en circulación de su red a la Casa (cobro = fichas × precio mayorista).',
                  'Su red gana los permisos de mover plata; el socio pasa a bancar lo suyo.',
                  'Deja de cobrar comisión (pasa a ganar por margen de reventa).',
                  'Su sub-red se aísla de la vista del admin.',
                ]
              : [
                  'El stock propio sin vender del socio se quema sin reintegro.',
                  'La Casa reabsorbe el respaldo de su red; su red pierde los permisos de plata.',
                  'Vuelve a devengar comisión %.',
                  'Su sub-red reaparece en la vista del admin.',
                ]
            ).map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-[var(--color-accent-text)] shrink-0">
                  •
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </ConfirmModal>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// F1: SalarySection — sueldo mensual del empleado (admin-only).
// El motor de comisiones descuenta este monto del NetWin del socio dueño
// de la rama al liquidar. Endpoints en /tenant/employees/:userId/salary.
// ──────────────────────────────────────────────────────────────────────

function fmtMoney(x: number): string {
  return x.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function SalarySection({ userId }: { userId: string }) {
  const { data: salary, isLoading } = useEmployeeSalary(userId, true);
  const setSalary = useSetEmployeeSalary(userId);

  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Sincronizar el form con el valor server-side cuando carga o cambia.
  useEffect(() => {
    setAmount(salary ? salary.monthlyAmount : '');
    setNotes(salary?.notes ?? '');
  }, [salary]);

  const num = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(num) && num >= 0;
  const amountChanged = salary ? num !== Number(salary.monthlyAmount) : true;
  const notesChanged = notes !== (salary?.notes ?? '');
  const changed = valid && (amountChanged || notesChanged);

  const handleSave = async (): Promise<void> => {
    if (!valid) {
      toast.error('Cargá un monto válido (0 o más).');
      return;
    }
    try {
      await setSalary.mutateAsync({
        monthlyAmount: num,
        notes: notes.trim() || null,
      });
      toast.success('Sueldo guardado', {
        description:
          num === 0
            ? 'El empleado queda sin sueldo (0).'
            : `Sueldo mensual: ${fmtMoney(num)} ARS.`,
      });
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapSalaryError(err) });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        label="Sueldo mensual"
        icon={<Banknote className="size-3 text-[var(--color-accent-text)]" />}
      />
      <p className="text-[11px] text-[var(--color-fg-subtle)] leading-snug">
        Al liquidar, el motor de comisiones descuenta este sueldo del NetWin del
        socio dueño de la rama (F1). 0 = sin sueldo.
      </p>
      <div className="flex flex-col gap-2.5 p-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
        {isLoading ? (
          <Skeleton className="h-24 w-full bg-[var(--color-bg-subtle)]" />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                Actual
              </span>
              <span className="text-[13px] font-mono text-[var(--color-fg)]">
                {salary
                  ? `${fmtMoney(Number(salary.monthlyAmount))} ${salary.currency}`
                  : 'Sin sueldo'}
              </span>
            </div>
            <FormField id="sal-amount" label="Sueldo mensual (ARS)">
              <Input
                id="sal-amount"
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^0-9.]/g, ''))
                }
                placeholder="0.00"
                disabled={setSalary.isPending}
                className="font-mono"
                inputMode="decimal"
              />
            </FormField>
            <FormField id="sal-notes" label="Notas (opcional)">
              <Input
                id="sal-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ej. sueldo base, comisión aparte"
                disabled={setSalary.isPending}
                maxLength={1000}
              />
            </FormField>
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={setSalary.isPending || !changed}
              >
                <Save className="size-3" />
                {setSalary.isPending ? 'Guardando…' : 'Guardar sueldo'}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function mapSalaryError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'Solo el admin del tenant puede fijar sueldos.';
  if (err.status === 404) return 'Usuario no encontrado.';
  if (err.status === 400) return err.message || 'Monto inválido.';
  return err.message || 'Error inesperado.';
}

function mapBranchError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) {
    return 'No tenés permiso para operar sucursales (admin only).';
  }
  if (err.status === 404) return 'Socio no encontrado.';
  if (err.status === 400) {
    if (err.code === 'BRANCH_NOT_A_SOCIO') return 'Este usuario no es socio.';
    if (err.code === 'BRANCH_PRICE_NOT_CONFIGURED') {
      return 'Falta configurar el precio mayorista.';
    }
    if (err.code === 'BRANCH_INVALID_PRICE') {
      return 'Precio o monto inválido.';
    }
    return err.message || 'Datos inválidos.';
  }
  if (err.status === 409) {
    if (err.code === 'BRANCH_NOT_INDEPENDENT') {
      return 'Activá el modo independiente antes de vender fichas.';
    }
    if (err.code === 'BRANCH_FLIP_PENDING_REQUESTS') {
      return 'Su red tiene depósitos o retiros pendientes. Aprobalos o rechazalos antes de cambiar el modo (no se puede forzar).';
    }
    if (err.code === 'BRANCH_DEGRADE_BLOCKED') {
      return 'Quedan transferencias sin conciliar, bonos activos o fraude sin resolver en su red. Limpialos antes de degradar.';
    }
    if (err.code === 'HOUSE_INSUFFICIENT_STOCK') {
      return 'La Casa no tiene stock suficiente para venderle el saldo en circulación. Fondeá el presupuesto de la Casa e intentá de nuevo.';
    }
    return err.message || 'Conflicto.';
  }
  return err.message || 'Error inesperado.';
}
