/**
 * /users/:id — Perfil completo de un usuario.
 *
 * Reemplaza el UserDetailDrawer con una página full-screen que volcada
 * toda la información del usuario: perfil, roles, permisos, wallet,
 * acciones operativas (cargar/retirar/corrección/bono), branch config,
 * sueldo, y edición inline.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpToLine,
  Banknote,
  Building2,
  Coins,
  ExternalLink,
  Gift,
  KeyRound,
  LogIn,
  Network,
  Pencil,
  Power,
  Save,
  ShieldCheck,
  Sliders,
  Store,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { GrantBonusModal } from '@/components/admin/grant-bonus-modal';
import { Input } from '@/components/ui/input';
import { ResetPasswordModal } from '@/components/admin/reset-password-modal';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { CorrectionModal } from '@/components/admin/correction-modal';
import {
  LoadUnloadModal,
  type LoadUnloadMode,
} from '@/components/admin/load-unload-modal';
import { UserSelect } from '@/components/ui/user-select';
import { isApiError } from '@/lib/api-client';
import { useAuth, isAdminTenant } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { USER_STATUSES } from '@/lib/constants';
import { getPermissionMeta } from '@/lib/permission-meta';
import {
  useClearParent,
  useSetParent,
  useUpdateUser,
  useUserDetail,
  useUserParent,
  type TenantUserRow,
} from '@/lib/hooks/use-users';
import {
  useEmployeeSalary,
  useSetEmployeeSalary,
} from '@/lib/hooks/use-employee-salaries';
import {
  useSellBranchChips,
  useToggleBranchIndependence,
} from '@/lib/hooks/use-branches';
import {
  useUserTransactions,
  useUserWallet,
  type WalletTransaction,
} from '@/lib/hooks/use-wallet';
import { useUserCap } from '@/lib/hooks/use-correction';
import { RiskBadge } from '@/components/admin/permission-info';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  banned: 'danger',
  suspended: 'warning',
  pending: 'neutral',
};

const SALARIED_ROLE_CODES = ['cajero', 'distribuidor', 'empleado'];

const TX_TYPE_VARIANT: Record<string, BadgeVariant> = {
  mint: 'success',
  burn: 'danger',
  bonus_funding: 'info',
  bonus_funding_revert: 'neutral',
  bonus_clear: 'success',
  load: 'success',
  transfer_in: 'success',
  transfer_out: 'warning',
  unload: 'warning',
  deposit_credit: 'success',
  withdrawal_debit: 'warning',
  cashback_credit: 'success',
};

const editSchema = z.object({
  status: z.enum(['active', 'pending', 'suspended', 'banned']),
  displayName: z.string().min(1, 'Requerido.').max(100),
  email: z.string().email('Email inválido.').optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
});

type EditValues = z.infer<typeof editSchema>;

export default function UserProfilePage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const router = useRouter();
  const { user: actor, impersonate } = useAuth();

  const userQ = useUserDetail(userId);
  const walletQ = useUserWallet(userId);
  const txsQ = useUserTransactions(userId, 5, 0);
  const parentQ = useUserParent(userId);
  const setParent = useSetParent(userId);
  const clearParent = useClearParent(userId);

  const [loadModal, setLoadModal] = useState<LoadUnloadMode | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [grantBonusOpen, setGrantBonusOpen] = useState(false);
  const [confirmImpersonate, setConfirmImpersonate] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [blockModal, setBlockModal] = useState(false);
  const [hierarchyModalOpen, setHierarchyModalOpen] = useState(false);
  const [newParentUser, setNewParentUser] = useState<TenantUserRow | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [interveneReason, setInterveneReason] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const data = userQ.data;

  const canImpersonate =
    !!data && !!actor && actor.id !== data.user.id && !actor.impersonatedBy;
  const canResetPassword = !!data && !!actor && actor.id !== data.user.id;
  const isIndependentTarget = !!data?.user.underIndependentBranch;

  const showSalary =
    isAdminTenant(actor) &&
    data?.roles.some((r) => SALARIED_ROLE_CODES.includes(r.code));

  const canCorrect =
    actor?.effectivePermissions === undefined ||
    actor.effectivePermissions.includes('wallet.correct');
  const canEditCap =
    actor?.effectivePermissions === undefined ||
    actor.effectivePermissions.includes('users.edit');
  const capQ = useUserCap(canEditCap && actor?.id !== userId ? userId : null);

  const targetUserRow: TenantUserRow | null = data
    ? {
        id: data.user.id,
        username: data.user.username,
        email: data.user.email,
        displayName: data.user.displayName,
        status: data.user.status,
        createdAt: data.user.createdAt,
        lastLoginAt: null,
        roleCodes: data.roles.map((r) => r.code),
        parentUserId: null,
        parentUsername: null,
        walletBalance: walletQ.data?.balance ?? null,
        bonusBalance: walletQ.data?.bonusBalance ?? null,
        isIndependentBranch: !!data.user.isIndependentBranch,
        underIndependentBranch: !!data.user.underIndependentBranch,
      }
    : null;

  async function handleImpersonate(): Promise<void> {
    if (!data) return;
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
      toast.success(`Ahora operás como @${data.user.username}.`);
      setConfirmImpersonate(false);
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
    <div className="px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Breadcrumb */}
      <Link
        href="/users"
        className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1.5 self-start"
      >
        <ArrowLeft className="size-3" />
        Volver a usuarios
      </Link>

      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
        <div className="flex items-center gap-4">
          <Avatar
            name={data?.user.displayName ?? data?.user.username ?? '?'}
            size="lg"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <UserRound className="size-3" />
              Perfil de usuario
            </span>
            <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight flex items-center gap-3 flex-wrap">
              {userQ.isLoading
                ? '…'
                : data?.user.displayName ?? data?.user.username}
              {data && (
                <Badge
                  variant={STATUS_VARIANT[data.user.status] ?? 'neutral'}
                  dot
                >
                  {data.user.status}
                </Badge>
              )}
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] font-mono">
              @{data?.user.username ?? userId.slice(0, 13) + '…'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canImpersonate && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => setConfirmImpersonate(true)}
            >
              <LogIn className="size-3.5" />
              Impersonar
            </Button>
          )}
          {canResetPassword && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => setResetPasswordOpen(true)}
            >
              <KeyRound className="size-3.5" />
              Reset password
            </Button>
          )}
          <Button
            variant="secondary"
            size="md"
            onClick={() => setBlockModal(true)}
            disabled={data?.user.status === 'banned'}
          >
            Bloquear
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
          >
            <Pencil className="size-3.5" />
            {mode === 'edit' ? 'Cancelar' : 'Editar'}
          </Button>
        </div>
      </header>

      {userQ.isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-48 w-full bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-64 w-full bg-[var(--color-bg-subtle)]" />
        </div>
      ) : userQ.isError || !data ? (
        <EmptyState
          hint="user_detail"
          label="No se pudo cargar el perfil del usuario."
          action={
            <Button variant="secondary" size="sm" onClick={() => userQ.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-px bg-[var(--color-border)]">
          {/* ─── Columna izquierda: datos ─── */}
          <div className="bg-[var(--color-bg-elevated)] p-6 flex flex-col gap-6">
            {mode === 'edit' ? (
              <EditMode
                data={data}
                userId={data.user.id}
                onCancel={() => setMode('view')}
                onSaved={() => setMode('view')}
              />
            ) : (
              <>
                {/* Perfil */}
                <section className="flex flex-col gap-3">
                  <SectionHeader label="Datos personales" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <DetailRow label="Email" value={data.user.email ?? '—'} mono />
                    <DetailRow label="Teléfono" value={data.user.phone ?? '—'} mono />
                    <DetailRow
                      label="2FA"
                      valueNode={
                        data.user.twoFaEnabled ? (
                          <Badge variant="success" dot>Activo</Badge>
                        ) : (
                          <Badge variant="neutral">Inactivo</Badge>
                        )
                      }
                    />
                    <DetailRow label="Creado" value={formatDate(data.user.createdAt)} mono />
                    <DetailRow label="Actualizado" value={formatDate(data.user.updatedAt)} mono />
                  </div>
                </section>

                {/* Roles */}
                <section className="flex flex-col gap-3">
                  <SectionHeader label={`Roles (${data.roles.length})`} />
                  <div className="flex flex-wrap gap-1.5">
                    {data.roles.length === 0 ? (
                      <span className="text-[12px] text-[var(--color-fg-subtle)] italic">Sin roles</span>
                    ) : (
                      data.roles.map((r) => (
                        <Badge key={r.code} variant={r.isSystem ? 'danger' : 'neutral'}>
                          {r.name || r.code}
                        </Badge>
                      ))
                    )}
                  </div>
                </section>

                {/* Jerarquía */}
                {actor?.effectivePermissions === undefined ||
                  actor.effectivePermissions.includes('users.change_hierarchy') ? (
                  <HierarchySection
                    userId={userId}
                    parentQ={parentQ}
                    setParent={setParent}
                    clearParent={clearParent}
                    hierarchyModalOpen={hierarchyModalOpen}
                    setHierarchyModalOpen={setHierarchyModalOpen}
                    newParentUser={newParentUser}
                    setNewParentUser={setNewParentUser}
                  />
                ) : null}

                {/* Permisos */}
                <section className="flex flex-col gap-3">
                  <SectionHeader
                    label={`Permisos efectivos (${data.effectivePermissions.length})`}
                    icon={<ShieldCheck className="size-3 text-[var(--color-accent-text)]" />}
                  />
                  <div className="bg-[var(--color-bg)] border border-[var(--color-border)] max-h-[280px] overflow-y-auto">
                    {data.effectivePermissions.length === 0 ? (
                      <div className="p-3 text-[12px] text-[var(--color-fg-subtle)] italic">Sin permisos</div>
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
                                <span className="text-[12px] text-[var(--color-fg)] truncate">{meta.label}</span>
                                <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] truncate">{perm}</span>
                              </div>
                              {meta.risk === 'high' && <RiskBadge risk="high" className="ml-auto" />}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </section>

                {/* Branch (socios) */}
                {data.roles.some((r) => r.code === 'socio') && (
                  <BranchSection data={data} />
                )}

                {/* Salary (admin + salariados) */}
                {showSalary && <SalarySection userId={data.user.id} />}
              </>
            )}
          </div>

          {/* ─── Columna derecha: acciones + wallet ─── */}
          <div className="bg-[var(--color-bg-elevated)] p-6 flex flex-col gap-6">
            {/* Acciones operativas */}
            <section className="flex flex-col gap-2">
              <SectionHeader label="Acciones" />

              <button
                type="button"
                onClick={() => setLoadModal('load')}
                disabled={!targetUserRow || actor?.id === userId || targetUserRow.isIndependentBranch}
                className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-success)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                title={targetUserRow?.isIndependentBranch ? 'El socio independiente se abastece por la venta de fichas (Sucursales).' : undefined}
              >
                <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-success)] group-hover:border-[var(--color-success)] transition-colors">
                  <ArrowDownToLine className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Cargar fichas</div>
                  <div className="text-[11px] text-[var(--color-fg-subtle)]">Tu wallet → este usuario</div>
                </div>
              </button>

              {targetUserRow?.isIndependentBranch && (
                <Link
                  href="/branches"
                  className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-success)] transition-colors text-left"
                >
                  <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-success)] group-hover:border-[var(--color-success)] transition-colors">
                    <Store className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Venderle fichas</div>
                    <div className="text-[11px] text-[var(--color-fg-subtle)]">Socio independiente — venta de fichas (Sucursales)</div>
                  </div>
                </Link>
              )}

              <button
                type="button"
                onClick={() => setLoadModal('unload')}
                disabled={!targetUserRow || actor?.id === userId}
                className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-warning)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-warning)] group-hover:border-[var(--color-warning)] transition-colors">
                  <ArrowUpToLine className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Retirar fichas</div>
                  <div className="text-[11px] text-[var(--color-fg-subtle)]">Este usuario → tu wallet</div>
                </div>
              </button>

              {canCorrect && actor?.id !== userId && !targetUserRow?.isIndependentBranch && (
                <button
                  type="button"
                  onClick={() => setCorrectionOpen(true)}
                  disabled={!targetUserRow}
                  className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-info)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-info)] group-hover:border-[var(--color-info)] transition-colors">
                    <Wrench className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Carga por corrección</div>
                    <div className="text-[11px] text-[var(--color-fg-subtle)]">Corrección / bonificación / reintegro</div>
                  </div>
                </button>
              )}

              {/* 2026-07: bono solo para usuarios finales */}
              {data.roles.some((r) => r.code === 'usuario_final') && (
                <button
                  type="button"
                  onClick={() => setGrantBonusOpen(true)}
                  disabled={!targetUserRow}
                  className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-accent-border)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)] group-hover:border-[var(--color-accent)] transition-colors">
                    <Gift className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Otorgar bono</div>
                    <div className="text-[11px] text-[var(--color-fg-subtle)]">Seleccionar bono y monto</div>
                  </div>
                </button>
              )}

              {canEditCap && actor?.id !== userId && (
                <button
                  type="button"
                  onClick={() => {
                    /* navigate to wallet page for cap config */
                    router.push(`/users/${userId}/wallet`);
                  }}
                  disabled={!targetUserRow}
                  className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-fg)] group-hover:border-[var(--color-border-strong)] transition-colors">
                    <Sliders className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Cupo de correcciones</div>
                    <div className="text-[11px] text-[var(--color-fg-subtle)]">
                      {capQ.data
                        ? `Cupo actual: ${Number(capQ.data.cap).toLocaleString('es-AR', { minimumFractionDigits: 2 })} / mes`
                        : 'Configurar techo mensual'}
                    </div>
                  </div>
                </button>
              )}
            </section>

            {/* Wallet */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <SectionHeader label="Wallet" icon={<Banknote className="size-3 text-[var(--color-accent-text)]" />} />
                <Link
                  href={`/users/${userId}/wallet`}
                  className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1"
                >
                  Ver completo
                  <ExternalLink className="size-3" />
                </Link>
              </div>

              {walletQ.isLoading ? (
                <Skeleton className="h-20 w-full bg-[var(--color-bg-subtle)]" />
              ) : walletQ.isError ? (
                <span className="text-[12px] text-[var(--color-fg-subtle)]">Sin wallet</span>
              ) : walletQ.data ? (
                <div className="bg-[var(--color-bg)] border border-[var(--color-border)] p-4 flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-mono num leading-none text-[var(--color-fg)]">
                      {formatBalance(walletQ.data.balance)}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--color-fg-subtle)] uppercase">
                      {walletQ.data.currency}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                    <span>Bloqueado: {walletQ.data.lockedBalance}</span>
                    <span>v{walletQ.data.version}</span>
                  </div>
                </div>
              ) : null}

              {/* Últimas transacciones */}
              {txsQ.data && txsQ.data.data.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
                    Últimos movimientos
                  </span>
                  {txsQ.data.data.map((tx) => (
                    <TxRow key={tx.id} tx={tx} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* ─── Modals ─── */}
      {targetUserRow && actor && loadModal && (
        <LoadUnloadModal
          mode={loadModal}
          open
          onOpenChange={(o) => !o && setLoadModal(null)}
          presetTargetUser={targetUserRow}
          actorUserId={actor.id}
        />
      )}

      {targetUserRow && (
        <CorrectionModal
          open={correctionOpen}
          onOpenChange={setCorrectionOpen}
          targetUserId={targetUserRow.id}
          targetUsername={targetUserRow.username}
        />
      )}

      {data && (
        <GrantBonusModal
          open={grantBonusOpen}
          onOpenChange={setGrantBonusOpen}
          actorUserId={actor?.id ?? ''}
          presetTargetUser={{
            id: data.user.id,
            username: data.user.username,
            displayName: data.user.displayName,
          } as TenantUserRow}
        />
      )}

      {data && (
        <ConfirmModal
          open={confirmImpersonate}
          onOpenChange={(o) => {
            setConfirmImpersonate(o);
            if (!o) setInterveneReason('');
          }}
          title={`¿Impersonate a @${data.user.username}?`}
          description="Vas a operar como este usuario hasta que vuelvas atrás."
          warning={
            isIndependentTarget
              ? 'Intervención en sub-red independiente: severidad CRITICAL.'
              : 'Severidad alta: el audit log registra la operación.'
          }
          confirmLabel="Impersonate"
          confirmIcon={<LogIn className="size-3.5" />}
          confirmVariant="outline-accent"
          onConfirm={handleImpersonate}
          isPending={impersonating}
        >
          {isIndependentTarget && (
            <div className="flex flex-col gap-1.5 mt-3">
              <label className="text-[12px] font-medium text-[var(--color-fg)]">Motivo *</label>
              <textarea
                value={interveneReason}
                onChange={(e) => setInterveneReason(e.target.value)}
                placeholder="Ej: Soporte técnico..."
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

      <ConfirmWithReasonModal
        open={blockModal}
        onOpenChange={setBlockModal}
        title="Bloquear usuario"
        description="El usuario no podrá iniciar sesión hasta que lo desbloquees."
        warning="Esta acción deshabilita la cuenta. Queda en audit log permanente."
        confirmLabel="Bloquear"
        reasonPlaceholder="Ej: Cuenta duplicada, fraude confirmado..."
        onConfirm={async (reason) => {
          if (!data) return;
          try {
            await fetch(`/api/tenant/users/${data.user.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'banned' }),
            });
            toast.success('Usuario bloqueado', {
              description: `@${data.user.username} fue bloqueado. Razón: ${reason}`,
            });
            setBlockModal(false);
            userQ.refetch();
          } catch {
            toast.error('No se pudo bloquear');
          }
        }}
      />
    </div>
  );
}

// ─── Sub-components ───

function SectionHeader({ label, icon }: { label: string; icon?: React.ReactNode }) {
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
  valueNode?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {valueNode ?? (
        <span className={cn('text-[13px] text-[var(--color-fg)]', mono && 'font-mono')}>
          {value}
        </span>
      )}
    </div>
  );
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const sizeClass = size === 'lg' ? 'size-12 text-[13px]' : 'size-8 text-[11px]';
  return (
    <div
      className={cn(
        'border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] flex items-center justify-center font-mono uppercase shrink-0 text-[var(--color-fg-muted)]',
        sizeClass,
      )}
    >
      {initials || '?'}
    </div>
  );
}

function TxRow({ tx }: { tx: WalletTransaction }) {
  const variant = TX_TYPE_VARIANT[tx.type] ?? 'neutral';
  const isCredit =
    tx.type === 'mint' ||
    tx.type === 'load' ||
    tx.type === 'transfer_in' ||
    tx.type === 'bonus_clear' ||
    tx.type === 'deposit_credit' ||
    tx.type === 'cashback_credit';
  const sign = isCredit ? '+' : '−';
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-[var(--color-border)] last:border-b-0">
      <Badge variant={variant} className="text-[10px]">
        {tx.type}
      </Badge>
      <span className={cn('text-[12px] font-mono', isCredit ? 'text-[var(--color-success)]' : 'text-[var(--color-fg-muted)]')}>
        {sign}{tx.amount}
      </span>
    </div>
  );
}

function EditMode({
  data,
  userId,
  onCancel,
  onSaved,
}: {
  data: NonNullable<ReturnType<typeof useUserDetail>['data']>;
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
      toast.success('Cambios guardados');
      onSaved();
    } catch (err) {
      const msg = !isApiError(err)
        ? 'Error de conexión.'
        : err.status === 409
          ? 'El email ya está en uso.'
          : err.status === 403
            ? 'Sin permiso.'
            : err.message || 'Error.';
      toast.error('No se pudo guardar', { description: msg });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <SectionHeader label="Editar perfil" />

      <FormField id="ed-status" label="Estado" required error={errors.status?.message}>
        <Select id="ed-status" invalid={!!errors.status} {...register('status')}>
          {USER_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      </FormField>

      <FormField id="ed-displayName" label="Nombre visible" required error={errors.displayName?.message}>
        <Input id="ed-displayName" type="text" invalid={!!errors.displayName} {...register('displayName')} />
      </FormField>

      <FormField id="ed-email" label="Email" error={errors.email?.message}>
        <Input id="ed-email" type="email" invalid={!!errors.email} {...register('email')} />
      </FormField>

      <FormField id="ed-phone" label="Teléfono" error={errors.phone?.message}>
        <Input id="ed-phone" type="tel" invalid={!!errors.phone} {...register('phone')} />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
        <Button type="button" variant="secondary" size="md" onClick={onCancel} disabled={update.isPending}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={update.isPending || !isDirty}>
          {update.isPending ? (
            <>
              <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
              Guardando…
            </>
          ) : (
            <>
              <Save className="size-3.5" />
              Guardar
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function BranchSection({ data }: { data: NonNullable<ReturnType<typeof useUserDetail>['data']> }) {
  const socioId = data.user.id;
  const isIndependent = !!data.user.isIndependentBranch;
  const toggle = useToggleBranchIndependence(socioId);
  const sell = useSellBranchChips(socioId);

  const [bankAccount, setBankAccount] = useState(data.user.branchBankAccount ?? '');
  const [price, setPrice] = useState(data.user.branchChipsPricePerUnit ?? '1.0000');
  const [sellAmount, setSellAmount] = useState('');
  const [sellNotes, setSellNotes] = useState('');
  const [flipConfirm, setFlipConfirm] = useState<'activate' | 'deactivate' | null>(null);

  useEffect(() => {
    setBankAccount(data.user.branchBankAccount ?? '');
    setPrice(data.user.branchChipsPricePerUnit ?? '1.0000');
  }, [data.user.branchBankAccount, data.user.branchChipsPricePerUnit]);

  const handleActivate = async () => {
    if (!bankAccount.trim()) { toast.error('Cargá el CBU/alias.'); return; }
    if (Number(price) <= 0) { toast.error('El precio debe ser > 0.'); return; }
    try {
      await toggle.mutateAsync({ isIndependent: true, branchBankAccount: bankAccount.trim(), branchChipsPricePerUnit: price });
      toast.success('Sucursal activada');
      setFlipConfirm(null);
    } catch (err) {
      toast.error('No se pudo activar', { description: mapBranchError(err) });
    }
  };

  const handleDeactivate = async () => {
    try {
      await toggle.mutateAsync({ isIndependent: false });
      toast.success('Sucursal desactivada');
      setFlipConfirm(null);
    } catch (err) {
      toast.error('No se pudo desactivar', { description: mapBranchError(err) });
    }
  };

  const handleSell = async () => {
    if (!sellAmount || Number(sellAmount) <= 0) { toast.error('Cargá el monto.'); return; }
    try {
      const result = await sell.mutateAsync({ amountChips: sellAmount, notes: sellNotes || undefined });
      toast.success('Fichas vendidas', { description: `${result.amountChips} fichas → ${result.amountFiat} fiat` });
      setSellAmount(''); setSellNotes('');
    } catch (err) {
      toast.error('No se pudo vender', { description: mapBranchError(err) });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader label="Sucursal independiente" icon={<Building2 className="size-3 text-[var(--color-accent-text)]" />} />

      <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">Modo</span>
          <span className="text-[13px] text-[var(--color-fg)]">{isIndependent ? 'Independiente' : 'Dependiente'}</span>
        </div>
        <Badge variant={isIndependent ? 'info' : 'neutral'} dot>{isIndependent ? 'INDEPENDENT' : 'DEPENDENT'}</Badge>
      </div>

      <div className="flex flex-col gap-2.5 p-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
        <FormField id="br-bank" label="CBU/alias del banco propio">
          <Input id="br-bank" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="CBU o alias" disabled={toggle.isPending} className="font-mono" />
        </FormField>
        <FormField id="br-price" label="Precio mayorista (por ficha)">
          <Input id="br-price" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="1.0000" disabled={toggle.isPending} className="font-mono" />
        </FormField>
        <div className="flex justify-end gap-2 pt-1">
          {isIndependent ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => setFlipConfirm('deactivate')} disabled={toggle.isPending}>
                <Power className="size-3" /> Desactivar
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={handleActivate} disabled={toggle.isPending}>
                <Save className="size-3" /> Guardar
              </Button>
            </>
          ) : (
            <Button type="button" variant="primary" size="sm" onClick={() => setFlipConfirm('activate')} disabled={toggle.isPending}>
              <Power className="size-3" /> Activar independiente
            </Button>
          )}
        </div>
      </div>

      {isIndependent && (
        <div className="flex flex-col gap-2.5 p-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">Vender fichas</span>
          <FormField id="br-sell-amount" label="Fichas">
            <Input id="br-sell-amount" value={sellAmount} onChange={(e) => setSellAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" disabled={sell.isPending} className="font-mono" />
          </FormField>
          <FormField id="br-sell-notes" label="Notas (opcional)">
            <Input id="br-sell-notes" value={sellNotes} onChange={(e) => setSellNotes(e.target.value)} placeholder="venta semanal" disabled={sell.isPending} maxLength={500} />
          </FormField>
          <div className="flex justify-end pt-1">
            <Button type="button" variant="primary" size="sm" onClick={handleSell} disabled={sell.isPending || !sellAmount}>
              <Coins className="size-3" /> {sell.isPending ? 'Vendiendo…' : 'Vender'}
            </Button>
          </div>
        </div>
      )}

      {flipConfirm && (
        <ConfirmModal
          open={flipConfirm !== null}
          onOpenChange={(o) => { if (!o) setFlipConfirm(null); }}
          title={flipConfirm === 'activate' ? 'Activar sucursal independiente' : 'Volver a dependiente'}
          description={flipConfirm === 'activate' ? `@${data.user.username} pasa a bancar su propia red.` : `@${data.user.username} vuelve a ser comercial puro.`}
          warning={flipConfirm === 'activate' ? 'El socio compra el saldo en circulación de su red.' : 'El stock propio sin vender se quema.'}
          confirmLabel={flipConfirm === 'activate' ? 'Activar' : 'Degradar'}
          confirmVariant={flipConfirm === 'activate' ? 'primary' : 'danger'}
          confirmIcon={<Power className="size-3.5" />}
          onConfirm={flipConfirm === 'activate' ? handleActivate : handleDeactivate}
          isPending={toggle.isPending}
        />
      )}
    </section>
  );
}

function SalarySection({ userId }: { userId: string }) {
  const { data: salary, isLoading } = useEmployeeSalary(userId, true);
  const setSalary = useSetEmployeeSalary(userId);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setAmount(salary ? salary.monthlyAmount : '');
    setNotes(salary?.notes ?? '');
  }, [salary]);

  const num = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(num) && num >= 0;
  const amountChanged = salary ? num !== Number(salary.monthlyAmount) : true;
  const changed = valid && (amountChanged || notes !== (salary?.notes ?? ''));

  const handleSave = async () => {
    if (!valid) { toast.error('Monto inválido.'); return; }
    try {
      await setSalary.mutateAsync({ monthlyAmount: num, notes: notes.trim() || null });
      toast.success('Sueldo guardado');
    } catch {
      toast.error('No se pudo guardar');
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader label="Sueldo mensual" icon={<Banknote className="size-3 text-[var(--color-accent-text)]" />} />
      <p className="text-[11px] text-[var(--color-fg-subtle)] leading-snug">
        El motor de comisiones descuenta este sueldo del NetWin del socio dueño de la rama.
      </p>
      <div className="flex flex-col gap-2.5 p-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
        {isLoading ? (
          <Skeleton className="h-24 w-full bg-[var(--color-bg-subtle)]" />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">Actual</span>
              <span className="text-[13px] font-mono text-[var(--color-fg)]">
                {salary ? `${Number(salary.monthlyAmount).toLocaleString('es-AR', { minimumFractionDigits: 2 })} ${salary.currency}` : 'Sin sueldo'}
              </span>
            </div>
            <FormField id="sal-amount" label="Sueldo mensual (ARS)">
              <Input id="sal-amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" disabled={setSalary.isPending} className="font-mono" inputMode="decimal" />
            </FormField>
            <FormField id="sal-notes" label="Notas (opcional)">
              <Input id="sal-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="sueldo base" disabled={setSalary.isPending} maxLength={1000} />
            </FormField>
            <div className="flex justify-end pt-1">
              <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={setSalary.isPending || !changed}>
                <Save className="size-3" /> {setSalary.isPending ? 'Guardando…' : 'Guardar sueldo'}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ─── Helpers ───

function formatBalance(balance: string): string {
  const [int, dec] = balance.split('.');
  const withCommas = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${withCommas}.${dec}` : withCommas;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function mapBranchError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'Sin permiso para operar sucursales.';
  if (err.status === 404) return 'Socio no encontrado.';
  if (err.status === 400) {
    if (err.code === 'BRANCH_NOT_A_SOCIO') return 'Este usuario no es socio.';
    if (err.code === 'BRANCH_FLIP_PENDING_REQUESTS') return 'Hay depósitos/retiros pendientes en su red.';
    return err.message || 'Datos inválidos.';
  }
  return err.message || 'Error inesperado.';
}

function HierarchySection({
  userId,
  parentQ,
  setParent,
  clearParent,
  hierarchyModalOpen,
  setHierarchyModalOpen,
  newParentUser,
  setNewParentUser,
}: {
  userId: string;
  parentQ: ReturnType<typeof useUserParent>;
  setParent: ReturnType<typeof useSetParent>;
  clearParent: ReturnType<typeof useClearParent>;
  hierarchyModalOpen: boolean;
  setHierarchyModalOpen: (v: boolean) => void;
  newParentUser: TenantUserRow | null;
  setNewParentUser: (u: TenantUserRow | null) => void;
}) {
  const parent = parentQ.data?.parent;
  const [confirmClear, setConfirmClear] = useState(false);

  const handleSetParent = async () => {
    if (!newParentUser) return;
    try {
      await setParent.mutateAsync({
        parentUserId: newParentUser.id,
        relationType: 'asignado_manual',
      });
      toast.success('Padre asignado');
      setHierarchyModalOpen(false);
      setNewParentUser(null);
    } catch (err) {
      const msg = !isApiError(err)
        ? 'Error de conexión.'
        : err.status === 409
          ? 'No se puede asignar: crearía un ciclo en la jerarquía.'
          : err.status === 403
            ? 'Sin permiso para cambiar jerarquía.'
            : err.message || 'Error.';
      toast.error('No se pudo asignar padre', { description: msg });
    }
  };

  const handleClearParent = async () => {
    try {
      await clearParent.mutateAsync();
      toast.success('Padre removido');
      setConfirmClear(false);
    } catch (err) {
      const msg = !isApiError(err)
        ? 'Error de conexión.'
        : err.status === 403
          ? 'Sin permiso para cambiar jerarquía.'
          : err.message || 'Error.';
      toast.error('No se pudo remover padre', { description: msg });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader label="Jerarquía" icon={<Network className="size-3 text-[var(--color-accent-text)]" />} />

      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] p-4 flex flex-col gap-3">
        {parentQ.isLoading ? (
          <Skeleton className="h-10 w-full bg-[var(--color-bg-subtle)]" />
        ) : parent ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                Padre directo
              </span>
              <span className="text-[13px] text-[var(--color-fg)] truncate">
                {parent.parentUserId.slice(0, 8)}…
              </span>
              <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                {parent.relationType}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setHierarchyModalOpen(true)}
              >
                <Pencil className="size-3" />
                Cambiar
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmClear(true)}
              >
                Quitar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                Padre directo
              </span>
              <span className="text-[13px] text-[var(--color-fg-subtle)] italic">
                Sin padre (raíz)
              </span>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setHierarchyModalOpen(true)}
            >
              <Pencil className="size-3" />
              Asignar padre
            </Button>
          </div>
        )}
      </div>

      {/* Change parent modal */}
      {hierarchyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] w-full max-w-md p-6 flex flex-col gap-4 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-[var(--color-fg)]">
                Cambiar padre
              </span>
              <button
                type="button"
                onClick={() => { setHierarchyModalOpen(false); setNewParentUser(null); }}
                className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              >
                <X className="size-4" />
              </button>
            </div>

            <UserSelect
              value={newParentUser}
              onSelect={setNewParentUser}
              excludeUserId={userId}
              placeholder="Buscar nuevo padre..."
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => { setHierarchyModalOpen(false); setNewParentUser(null); }}
                disabled={setParent.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSetParent}
                disabled={!newParentUser || setParent.isPending}
              >
                {setParent.isPending ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Clear parent confirmation */}
      <ConfirmModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Quitar padre"
        description="El usuario pasará a ser un nodo raíz en la jerarquía."
        warning="Esto cambia la estructura de la red. Queda en audit log."
        confirmLabel="Quitar padre"
        confirmVariant="danger"
        onConfirm={handleClearParent}
        isPending={clearParent.isPending}
      />
    </section>
  );
}
