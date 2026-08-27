/**
 * /users/:id — Perfil completo de un usuario, unificado con su wallet.
 *
 * Página full-screen con header fijo (identidad + acciones globales) y 4
 * pestañas (docs/21-plan-perfil-wallet.md, Parte B):
 *   - Perfil       → datos personales, roles, jerarquía, sucursal (socios).
 *   - Wallet       → balance + acciones operativas (cargar/retirar/corrección/
 *                    bono · cupo solo empleados).
 *   - Movimientos  → tabla paginada de transacciones + export CSV.
 *   - Permisos     → permisos efectivos agrupados por categoría y por riesgo.
 *
 * Reemplaza la página separada /users/:id/wallet (ahora redirige acá con
 * ?tab=wallet). No toca saldos, transacciones ni holds: es presentación.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpToLine,
  Ban,
  Building2,
  Coins,
  Gift,
  History,
  KeyRound,
  LogIn,
  Network,
  Pencil,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
  Store,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useParams, useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { GrantBonusModal } from '@/components/admin/grant-bonus-modal';
import { RemoveBonusModal } from '@/components/admin/remove-bonus-modal';
import { Input } from '@/components/ui/input';
import { ResetPasswordModal } from '@/components/admin/reset-password-modal';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { CorrectionModal } from '@/components/admin/correction-modal';
import { EditCorrectionCapModal } from '@/components/admin/edit-correction-cap-modal';
import {
  LoadUnloadModal,
  type LoadUnloadMode,
} from '@/components/admin/load-unload-modal';
import { UserSelect } from '@/components/ui/user-select';
import { isApiError } from '@/lib/api-client';
import {
  useAuth,
  isAdminTenant,
  isIndependentBranch,
  hasPermission,
} from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { USER_STATUSES } from '@/lib/constants';
import {
  getCategoryLabel,
  getPermissionMeta,
  RISK_ORDER,
} from '@/lib/permission-meta';
import {
  useClearParent,
  useSetParent,
  useUpdateUser,
  useUserDetail,
  useUserParent,
  type TenantUserRow,
} from '@/lib/hooks/use-users';
import { useToggleBranchIndependence } from '@/lib/hooks/use-branches';
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
  inactive: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Activo',
  banned: 'Bloqueado',
  suspended: 'Suspendido',
  pending: 'Pendiente',
  inactive: 'Inactivo',
};

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

const PAGE_SIZE = 25;

type UserTab = 'perfil' | 'wallet' | 'movimientos' | 'permisos';

const TABS: { id: UserTab; label: string; icon: typeof UserRound }[] = [
  { id: 'perfil', label: 'Perfil', icon: UserRound },
  { id: 'wallet', label: 'Wallet', icon: Coins },
  { id: 'movimientos', label: 'Movimientos', icon: History },
  { id: 'permisos', label: 'Permisos', icon: ShieldCheck },
];

function isUserTab(v: string | null): v is UserTab {
  return v === 'perfil' || v === 'wallet' || v === 'movimientos' || v === 'permisos';
}

const editSchema = z.object({
  status: z.enum(['active', 'suspended', 'banned', 'inactive']),
  displayName: z.string().min(1, 'Requerido.').max(100),
  email: z.string().email('Email inválido.').optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
});

type EditValues = z.infer<typeof editSchema>;

export default function UserProfilePage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const router = useRouter();
  const pathname = usePathname();
  const { user: actor, impersonate } = useAuth();

  const userQ = useUserDetail(userId);
  const walletQ = useUserWallet(userId);
  const parentQ = useUserParent(userId);
  const setParent = useSetParent(userId);
  const clearParent = useClearParent(userId);

  const [tab, setTab] = useState<UserTab>(() => {
    if (typeof window === 'undefined') return 'perfil';
    const t = new URLSearchParams(window.location.search).get('tab');
    return isUserTab(t) ? t : 'perfil';
  });
  const [page, setPage] = useState(0);
  const txsQ = useUserTransactions(userId, PAGE_SIZE, page * PAGE_SIZE);

  const [loadModal, setLoadModal] = useState<LoadUnloadMode | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
  const [grantBonusOpen, setGrantBonusOpen] = useState(false);
  const [removeBonusOpen, setRemoveBonusOpen] = useState(false);
  const [confirmImpersonate, setConfirmImpersonate] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [blockModal, setBlockModal] = useState(false);
  const [hierarchyModalOpen, setHierarchyModalOpen] = useState(false);
  const [newParentUser, setNewParentUser] = useState<TenantUserRow | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  // Motivo de intervención: input NO controlado (ref) para que tipear no
  // re-renderice toda la página (evita el flicker del modal al escribir).
  const interveneReasonRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const data = userQ.data;

  const selectTab = (next: UserTab) => {
    setTab(next);
    const qs = next === 'perfil' ? '' : `?tab=${next}`;
    router.replace(`${pathname}${qs}`, { scroll: false });
  };

  // Impersonar solo para admin (permiso `users.impersonate`, LEYES P1). El OR
  // con isAdminTenant es resguardo si effectivePermissions llega vacío.
  const canImpersonate =
    !!data &&
    !!actor &&
    actor.id !== data.user.id &&
    !actor.impersonatedBy &&
    (isAdminTenant(actor) || actor.effectivePermissions?.includes('users.impersonate') === true);
  const canResetPassword = !!data && !!actor && actor.id !== data.user.id;
  const isIndependentTarget = !!data?.user.underIndependentBranch;

  // Carga por corrección: SOLO empleados de la red central (rol 'empleado',
  // rama dependiente). Es el ÚNICO canal de carga del empleado (docs/19): el
  // admin carga con wallet.load (tesorería) y los socios independientes
  // venden fichas por /branches.
  const isEmpleadoActor = actor?.roles?.includes('empleado') === true;
  // Gates de plata/bono: el backend los exige (403 si no) — escondemos los
  // botones para que la UI coincida. Un operador dependiente (comercial puro)
  // no tiene wallet.load/unload (R3); el bono manual pide bonuses.grant_manual
  // (o el bypass _admin_network del comodín).
  const canLoad = hasPermission(actor, 'wallet.load');
  const canUnload = hasPermission(actor, 'wallet.unload');
  const canGrantBonus =
    hasPermission(actor, 'bonuses.grant_manual') ||
    hasPermission(actor, 'bonuses.grant_manual_admin_network');
  const canCorrect =
    isEmpleadoActor &&
    !isAdminTenant(actor) &&
    !isIndependentBranch(actor) &&
    (actor.effectivePermissions?.includes('wallet.correct') ?? false);

  // Cupo de correcciones: solo tiene sentido en el TARGET que es empleado de la
  // red central (el cupo topa sus cargas por corrección + bonos, docs/19). No se
  // muestra en jugadores/socios/etc. (docs/21 §4.1).
  const targetIsEmpleado = data?.roles.some((r) => r.code === 'empleado') ?? false;
  const canEditCap =
    (actor?.effectivePermissions === undefined ||
      actor.effectivePermissions.includes('users.edit')) &&
    targetIsEmpleado &&
    !isIndependentTarget &&
    actor?.id !== userId;
  const capQ = useUserCap(canEditCap ? userId : null);

  // Permisos efectivos agrupados por categoría y ordenados por riesgo (docs/21
  // §4.5). La categoría se deriva del prefijo del código (wallet.load → wallet).
  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const perm of data?.effectivePermissions ?? []) {
      const category = perm.split('.')[0] || 'otros';
      const bucket = groups.get(category);
      if (bucket) bucket.push(perm);
      else groups.set(category, [perm]);
    }
    for (const perms of groups.values()) {
      perms.sort(
        (a, b) => RISK_ORDER[getPermissionMeta(a).risk] - RISK_ORDER[getPermissionMeta(b).risk],
      );
    }
    return [...groups.entries()].sort((a, b) => {
      const ra = Math.min(...a[1].map((p) => RISK_ORDER[getPermissionMeta(p).risk]));
      const rb = Math.min(...b[1].map((p) => RISK_ORDER[getPermissionMeta(p).risk]));
      return ra - rb || getCategoryLabel(a[0]).localeCompare(getCategoryLabel(b[0]));
    });
  }, [data?.effectivePermissions]);

  // Sprint: memoizado — sin esto, el polling de walletQ (20s) recreaba este
  // object literal en CADA render con una referencia nueva, lo que hacía que
  // LoadUnloadModal (recibe esto como presetTargetUser) reseteara su target
  // seleccionado mientras el operador estaba completando una carga manual.
  const targetUserRow: TenantUserRow | null = useMemo(
    () =>
      data
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
        : null,
    [data, walletQ.data?.balance, walletQ.data?.bonusBalance],
  );

  // ¿La card "Acciones" (tab wallet) tiene al menos un botón/nota visible? Si no
  // (operador comercial puro viendo a un jugador: sin cargar/retirar/bono/etc.),
  // se oculta la card entera para no dejar un recuadro vacío. Espeja las
  // condiciones de cada botón de abajo.
  const targetIsFinalUser =
    data?.roles.some((r) => r.code === 'usuario_final') ?? false;
  const hasAnyUserAction =
    (!isEmpleadoActor && canLoad) ||
    !!targetUserRow?.isIndependentBranch ||
    canUnload ||
    (canCorrect && actor?.id !== userId && !targetUserRow?.isIndependentBranch) ||
    (targetIsFinalUser && canGrantBonus) ||
    canEditCap ||
    actor?.id === userId;

  async function handleImpersonate(): Promise<void> {
    if (!data) return;
    const reason = interveneReasonRef.current?.value.trim() ?? '';
    if (isIndependentTarget && !reason) {
      toast.error('Debés escribir un motivo para intervenir una sub-red independiente.');
      return;
    }
    setImpersonating(true);
    try {
      const target = await impersonate(
        data.user.id,
        isIndependentTarget ? reason : undefined,
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

      {/* Header (fijo, arriba de las pestañas) */}
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
                  {STATUS_LABEL[data.user.status] ?? data.user.status}
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
            variant="danger-outline"
            size="md"
            onClick={() => setBlockModal(true)}
            disabled={data?.user.status === 'banned'}
          >
            <Ban className="size-3.5" />
            Bloquear
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              if (mode === 'edit') {
                setMode('view');
              } else {
                setMode('edit');
                selectTab('perfil');
              }
            }}
          >
            <Pencil className="size-3.5" />
            {mode === 'edit' ? 'Cancelar' : 'Editar'}
          </Button>
        </div>
      </header>

      {userQ.isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-11 w-full bg-[var(--color-bg-subtle)]" />
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
        <>
          {/* Tabs */}
          <div
            className="flex flex-wrap items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1 self-start"
            role="tablist"
            aria-label="Secciones del usuario"
          >
            {TABS.map((t) => {
              const active = tab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectTab(t.id)}
                  className={cn(
                    'inline-flex h-8 items-center gap-2 px-4 rounded-md text-[13px] font-medium transition-colors',
                    active
                      ? 'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]'
                      : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
                  )}
                >
                  <Icon className="size-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div key={tab} className="animate-page-enter">
            {tab === 'perfil' && (
              <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-6 flex flex-col gap-6">
                {mode === 'edit' ? (
                  <EditMode
                    data={data}
                    userId={data.user.id}
                    onCancel={() => setMode('view')}
                    onSaved={() => setMode('view')}
                  />
                ) : (
                  <>
                    {/* Datos personales */}
                    <section className="flex flex-col gap-3">
                      <SectionHeader label="Datos personales" />
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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

                    {/* Sucursal (socios) */}
                    {data.roles.some((r) => r.code === 'socio') && (
                      <BranchSection data={data} />
                    )}
                  </>
                )}
              </div>
            )}

            {tab === 'wallet' && (
              <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-px bg-[var(--color-border)]">
                {/* Balance */}
                <div className="bg-[var(--color-bg-elevated)] p-8 flex flex-col gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
                      Balance disponible
                    </span>
                    {walletQ.data && (
                      <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
                        · {walletQ.data.currency}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-3 min-h-[4rem]">
                    {walletQ.isLoading ? (
                      <Skeleton className="h-14 w-64 bg-[var(--color-bg-subtle)]" />
                    ) : walletQ.isError ? (
                      <span className="font-display text-3xl text-[var(--color-fg-subtle)]">—</span>
                    ) : (
                      <>
                        <span className="font-display text-[4rem] leading-none tabular-nums tracking-tight text-[var(--color-fg)]">
                          {formatBalance(walletQ.data?.balance ?? '0')}
                        </span>
                        <span className="text-sm font-mono text-[var(--color-fg-subtle)] uppercase tracking-[0.14em]">
                          fichas
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-6 text-[11px] text-[var(--color-fg-subtle)] uppercase tracking-[0.12em] pt-4 border-t border-[var(--color-border)]">
                    <Meta label="Bono" value={walletQ.data ? `${walletQ.data.bonusBalance} fichas` : '—'} />
                    <Meta label="Bloqueado" value={walletQ.data ? `${walletQ.data.lockedBalance} fichas` : '—'} />
                    <Meta label="Versión" value={walletQ.data ? String(walletQ.data.version) : '—'} />
                    <Meta label="Wallet ID" value={walletQ.data ? walletQ.data.id.slice(0, 8) + '…' : '—'} mono />
                  </div>
                </div>

                {/* Acciones operativas */}
                {hasAnyUserAction && (
                <div className="bg-[var(--color-bg-elevated)] p-6 flex flex-col gap-2">
                  <SectionHeader label="Acciones" />

                  {/* Cargar fichas (wallet.load) — NO aplica al rol empleado
                      (docs/19): los empleados cargan solo por corrección. Ni al
                      dependiente comercial (sin wallet.load, R3). */}
                  {!isEmpleadoActor && canLoad && (
                    <button
                      type="button"
                      onClick={() => setLoadModal('load')}
                      disabled={!targetUserRow || actor?.id === userId || targetUserRow.isIndependentBranch}
                      className="group flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-success)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                      title={targetUserRow?.isIndependentBranch ? 'El socio independiente se abastece por la venta de fichas (Sucursales).' : undefined}
                    >
                      <div className="size-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-success)] group-hover:border-[var(--color-success)] transition-colors">
                        <ArrowDownToLine className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Cargar fichas</div>
                        <div className="text-[11px] text-[var(--color-fg-subtle)]">Tu wallet → este usuario</div>
                      </div>
                    </button>
                  )}

                  {targetUserRow?.isIndependentBranch && (
                    <Link
                      href="/branches"
                      className="group flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-success)] transition-colors text-left"
                    >
                      <div className="size-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-success)] group-hover:border-[var(--color-success)] transition-colors">
                        <Store className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Venderle fichas</div>
                        <div className="text-[11px] text-[var(--color-fg-subtle)]">Socio independiente — venta de fichas (Sucursales)</div>
                      </div>
                    </Link>
                  )}

                  {canUnload && (
                    <button
                      type="button"
                      onClick={() => setLoadModal('unload')}
                      disabled={!targetUserRow || actor?.id === userId}
                      className="group flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-warning)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="size-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-warning)] group-hover:border-[var(--color-warning)] transition-colors">
                        <ArrowUpToLine className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Retirar fichas</div>
                        <div className="text-[11px] text-[var(--color-fg-subtle)]">Este usuario → tu wallet</div>
                      </div>
                    </button>
                  )}

                  {canCorrect && actor?.id !== userId && !targetUserRow?.isIndependentBranch && (
                    <button
                      type="button"
                      onClick={() => setCorrectionOpen(true)}
                      disabled={!targetUserRow}
                      className="group flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-info)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="size-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-info)] group-hover:border-[var(--color-info)] transition-colors">
                        <Wrench className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Carga por corrección</div>
                        <div className="text-[11px] text-[var(--color-fg-subtle)]">Corrección / bonificación / reintegro (contra tu cupo)</div>
                      </div>
                    </button>
                  )}

                  {/* 2026-07: bono solo para usuarios finales, y solo si el
                      actor tiene el permiso (bonuses.grant_manual). */}
                  {data.roles.some((r) => r.code === 'usuario_final') &&
                    canGrantBonus && (
                    <button
                      type="button"
                      onClick={() => setGrantBonusOpen(true)}
                      disabled={!targetUserRow}
                      className="group flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-accent-border)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="size-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)] group-hover:border-[var(--color-accent)] transition-colors">
                        <Gift className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Otorgar bono</div>
                        <div className="text-[11px] text-[var(--color-fg-subtle)]">Seleccionar bono y monto</div>
                      </div>
                    </button>
                  )}

                  {/* Sacar dinero de bono — solo usuarios finales + permiso */}
                  {data.roles.some((r) => r.code === 'usuario_final') &&
                    canGrantBonus && (
                    <button
                      type="button"
                      onClick={() => setRemoveBonusOpen(true)}
                      disabled={!targetUserRow}
                      className="group flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-danger)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="size-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-danger)] group-hover:border-[var(--color-danger)] transition-colors">
                        <Gift className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Sacar dinero de bono</div>
                        <div className="text-[11px] text-[var(--color-fg-subtle)]">Debita del bonus_balance · reverso al funder / Casa</div>
                      </div>
                    </button>
                  )}

                  {/* Cupo de correcciones — solo empleados de la red central (docs/21 §4.1) */}
                  {canEditCap && (
                    <button
                      type="button"
                      onClick={() => setCapOpen(true)}
                      disabled={!targetUserRow || !capQ.data}
                      className="group flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <div className="size-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-fg)] group-hover:border-[var(--color-border-strong)] transition-colors">
                        <Sliders className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">Cupo de correcciones</div>
                        <div className="text-[11px] text-[var(--color-fg-subtle)]">
                          {capQ.data
                            ? `Cupo actual: ${Number(capQ.data.cap).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / mes`
                            : 'Configurar techo mensual'}
                        </div>
                      </div>
                    </button>
                  )}

                  {actor?.id === userId && (
                    <p className="text-[11px] text-[var(--color-fg-subtle)] italic mt-2">
                      Esta es tu propia wallet. Para mint/burn, usá la página principal de Wallet.
                    </p>
                  )}
                </div>
                )}
              </section>
            )}

            {tab === 'movimientos' && (
              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
                    Movimientos · Página {page + 1}
                    {txsQ.data && (
                      <span className="ml-2 font-mono text-[var(--color-fg-subtle)]">
                        ({txsQ.data.total} total)
                      </span>
                    )}
                  </h2>
                  <div className="flex items-center gap-2">
                    <CsvExportButton
                      path={`/tenant/wallet/user/${userId}/transactions/export`}
                      filenameHint={`wallet_user_${userId.slice(0, 8)}`}
                      permission="wallet.export"
                      entityLabel="transacciones del usuario"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        walletQ.refetch();
                        txsQ.refetch();
                      }}
                      disabled={walletQ.isFetching || txsQ.isFetching}
                    >
                      <RefreshCw className={cn('size-3.5', (walletQ.isFetching || txsQ.isFetching) && 'animate-spin')} />
                      Refrescar
                    </Button>
                    <Pager
                      page={page}
                      total={txsQ.data?.total ?? 0}
                      onPrev={() => setPage((p) => Math.max(0, p - 1))}
                      onNext={() => setPage((p) => p + 1)}
                      hasMore={txsQ.data ? (page + 1) * PAGE_SIZE < txsQ.data.total : false}
                    />
                  </div>
                </div>

                <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
                  {txsQ.isLoading ? (
                    <LoadingTable />
                  ) : txsQ.isError ? (
                    <div className="p-6">
                      <EmptyState
                        hint="transactions"
                        label="No se pudo cargar el historial."
                        action={
                          <Button variant="secondary" size="sm" onClick={() => txsQ.refetch()}>
                            Reintentar
                          </Button>
                        }
                      />
                    </div>
                  ) : !txsQ.data || txsQ.data.data.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        hint="transactions"
                        stream={`wallet:user:${userId.slice(0, 8)}`}
                        label="Este usuario aún no tiene movimientos"
                      />
                    </div>
                  ) : (
                    <Table>
                      <THead>
                        <tr>
                          <TH>Tipo</TH>
                          <TH align="right">Monto</TH>
                          <TH align="right">Balance después</TH>
                          <TH>Motivo</TH>
                          <TH align="right">Fecha</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {txsQ.data.data.map((tx, i) => (
                          <TxRow key={tx.id} tx={tx} index={i} />
                        ))}
                      </TBody>
                    </Table>
                  )}
                </div>
              </section>
            )}

            {tab === 'permisos' && (
              <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-6 flex flex-col gap-5">
                <SectionHeader
                  label={`Permisos efectivos (${data.effectivePermissions.length})`}
                  icon={<ShieldCheck className="size-3 text-[var(--color-accent-text)]" />}
                />
                {data.effectivePermissions.length === 0 ? (
                  <div className="text-[12px] text-[var(--color-fg-subtle)] italic">Sin permisos</div>
                ) : (
                  <div className="flex flex-col gap-5">
                    {groupedPermissions.map(([category, perms]) => (
                      <section key={category} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg)] font-medium">
                            {getCategoryLabel(category)}
                          </span>
                          <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
                            {perms.length}
                          </span>
                        </div>
                        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-sm)] overflow-hidden">
                          <ul className="flex flex-col">
                            {perms.map((perm) => {
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
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
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

      {targetUserRow && capQ.data && (
        <EditCorrectionCapModal
          open={capOpen}
          onOpenChange={setCapOpen}
          userId={targetUserRow.id}
          username={targetUserRow.username}
          currentCap={capQ.data.cap}
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

      {targetUserRow && (
        <RemoveBonusModal
          open={removeBonusOpen}
          onOpenChange={setRemoveBonusOpen}
          targetUser={targetUserRow}
          bonusBalance={targetUserRow.bonusBalance}
        />
      )}

      {data && (
        <ConfirmModal
          open={confirmImpersonate}
          onOpenChange={(o) => {
            setConfirmImpersonate(o);
            if (!o && interveneReasonRef.current) interveneReasonRef.current.value = '';
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
                ref={interveneReasonRef}
                defaultValue=""
                placeholder="Ej: Soporte técnico..."
                rows={2}
                className="w-full px-3 py-2 rounded-[var(--radius-sm)] text-[13px] bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
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
        'rounded-full border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] flex items-center justify-center font-mono uppercase shrink-0 text-[var(--color-fg-muted)]',
        sizeClass,
      )}
    >
      {initials || '?'}
    </div>
  );
}

function TxRow({ tx, index }: { tx: WalletTransaction; index: number }) {
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
    <TR
      className="animate-fade-up-staggered"
      style={{ animationDelay: `${Math.min(index * 25, 500)}ms` }}
    >
      <TD>
        <Badge variant={variant} dot>
          {tx.type}
        </Badge>
      </TD>
      <TD numeric>
        <span className={cn(isCredit ? 'text-[var(--color-success)]' : 'text-[var(--color-accent-text)]')}>
          {sign} {tx.amount}
        </span>
      </TD>
      <TD numeric className="text-[var(--color-fg-muted)]">
        {tx.balanceAfter}
      </TD>
      <TD className="max-w-[400px]">
        <span className="text-[12px] text-[var(--color-fg-muted)] truncate block" title={tx.reason ?? undefined}>
          {tx.reason ?? '—'}
        </span>
      </TD>
      <TD numeric className="text-[var(--color-fg-subtle)]">
        {formatDateTime(tx.createdAt)}
      </TD>
    </TR>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>{label}</span>
      <span
        className={cn(
          'text-[12px] normal-case tracking-normal text-[var(--color-fg)] tabular-nums',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Pager({
  page,
  total,
  onPrev,
  onNext,
  hasMore,
}: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  hasMore: boolean;
}) {
  const start = page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, total);
  return (
    <div className="flex items-center gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-11 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-11 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full bg-[var(--color-bg-subtle)]" />
      ))}
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
    <form onSubmit={onSubmit} className="flex flex-col gap-5 max-w-xl" noValidate>
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

  const [flipConfirm, setFlipConfirm] = useState<'activate' | 'deactivate' | null>(null);

  // Activar es solo un botón: el PRECIO mayorista se decide POR VENTA en
  // Sucursales (no acá), y el CBU/alias lo carga el socio en su propio panel
  // ("Mis métodos de pago"). Desde la Opción C activa SIN CBU (queda
  // independiente pero no puede operar transferencias hasta cargarlo — ver el
  // aviso "Falta el CBU" del panel del socio).
  const handleActivate = async () => {
    try {
      await toggle.mutateAsync({ isIndependent: true });
      toast.success('Sucursal independiente activada');
      setFlipConfirm(null);
    } catch (err) {
      toast.error('No se pudo activar', { description: mapBranchError(err) });
    }
  };

  const handleDeactivate = async () => {
    try {
      await toggle.mutateAsync({ isIndependent: false });
      toast.success('Volvió a dependiente');
      setFlipConfirm(null);
    } catch (err) {
      toast.error('No se pudo desactivar', { description: mapBranchError(err) });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader label="Sucursal independiente" icon={<Building2 className="size-3 text-[var(--color-accent-text)]" />} />

      <div className="flex items-center justify-between p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)]">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">Modo</span>
          <span className="text-[13px] text-[var(--color-fg)]">{isIndependent ? 'Independiente' : 'Dependiente'}</span>
        </div>
        <Badge variant={isIndependent ? 'info' : 'neutral'} dot>{isIndependent ? 'INDEPENDENT' : 'DEPENDENT'}</Badge>
      </div>

      <div className="flex flex-col gap-2.5 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)]">
        <p className="text-[11px] text-[var(--color-fg-subtle)] leading-relaxed">
          {isIndependent ? (
            <>
              @{data.user.username} banca su propia red. El <strong>precio</strong>{' '}
              de cada venta de fichas se define en <strong>Sucursales</strong>, y el{' '}
              <strong>CBU/alias</strong> de aislamiento sale de su método de pago.{' '}
              CBU actual:{' '}
              <span className="font-mono text-[var(--color-fg-muted)]">
                {data.user.branchBankAccount || '—'}
              </span>
              .
            </>
          ) : (
            <>
              Al activar, @{data.user.username} pasa a{' '}
              <strong>bancar su propia red</strong>. El <strong>precio</strong> de
              las fichas se decide en cada venta desde <strong>Sucursales</strong>, y
              el <strong>CBU/alias</strong> de aislamiento se toma del método de pago
              bancario que el socio carga en su panel ("Mis métodos de pago"). Si
              todavía no cargó ninguno, primero pedíselo.
            </>
          )}
        </p>
        {isIndependent && !data.user.branchBankAccount && (
          <div className="flex flex-col gap-1 p-2.5 rounded-[var(--radius-sm)] border border-[var(--color-warning)]">
            <span className="text-[11px] font-semibold text-[var(--color-warning)] uppercase tracking-[0.08em]">
              Falta el CBU
            </span>
            <span className="text-[11px] text-[var(--color-fg-muted)] leading-relaxed">
              Ya es independiente, pero todavía <strong>no puede operar
              transferencias bancarias</strong>. Tiene que cargar su CBU/alias en
              "Mis métodos de pago" de su panel — ahí se activa el aislamiento y
              se habilitan las transferencias.
            </span>
          </div>
        )}
        <div className="flex justify-end pt-1">
          {isIndependent ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setFlipConfirm('deactivate')} disabled={toggle.isPending}>
              <Power className="size-3" /> Volver a dependiente
            </Button>
          ) : (
            <Button type="button" variant="primary" size="sm" onClick={() => setFlipConfirm('activate')} disabled={toggle.isPending}>
              <Power className="size-3" /> Activar independiente
            </Button>
          )}
        </div>
      </div>

      {flipConfirm && (
        <ConfirmModal
          open={flipConfirm !== null}
          onOpenChange={(o) => { if (!o) setFlipConfirm(null); }}
          title={flipConfirm === 'activate' ? 'Activar sucursal independiente' : 'Volver a dependiente'}
          description={flipConfirm === 'activate' ? `@${data.user.username} pasa a bancar su propia red. El precio se define por venta en Sucursales y el CBU sale de su método de pago.` : `@${data.user.username} vuelve a ser comercial puro.`}
          warning={flipConfirm === 'activate' ? 'El socio compra el saldo en circulación de su red. Si todavía no cargó su CBU, se activa igual pero no podrá operar transferencias hasta cargarlo en su panel.' : 'El stock propio sin vender se quema.'}
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

// ─── Helpers ───

function formatBalance(balance: string): string {
  const [int, dec] = balance.split('.');
  const withCommas = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${withCommas}.${dec}` : withCommas;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
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

  // Nombre del padre (docs/21 §4.3): el endpoint del padre solo devuelve el
  // parentUserId + relationType, así que traemos su detalle para mostrar
  // nombre + @usuario + link, no un uuid cortado.
  const parentDetailQ = useUserDetail(parent?.parentUserId ?? null);
  const parentUser = parentDetailQ.data?.user;

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

      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius)] p-4 flex flex-col gap-3">
        {parentQ.isLoading ? (
          <Skeleton className="h-10 w-full bg-[var(--color-bg-subtle)]" />
        ) : parent ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                Padre directo
              </span>
              {parentDetailQ.isLoading ? (
                <Skeleton className="h-4 w-32 bg-[var(--color-bg-subtle)]" />
              ) : parentUser ? (
                <Link
                  href={`/users/${parent.parentUserId}`}
                  className="text-[13px] text-[var(--color-fg)] hover:text-[var(--color-accent-text)] transition-colors truncate"
                >
                  {parentUser.displayName || parentUser.username}
                  <span className="ml-1.5 text-[11px] font-mono text-[var(--color-fg-subtle)]">
                    @{parentUser.username}
                  </span>
                </Link>
              ) : (
                <span className="text-[13px] text-[var(--color-fg)] font-mono truncate">
                  {parent.parentUserId.slice(0, 8)}…
                </span>
              )}
              <span className="text-[11px] text-[var(--color-fg-muted)]">
                {friendlyRelation(parent.relationType, parentUser?.displayName || parentUser?.username)}
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
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius-lg)] w-full max-w-md p-6 flex flex-col gap-4 shadow-xl">
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
              includeSelf
              placeholder="Buscar nuevo padre (incluye al admin / la casa)..."
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

/**
 * Traduce el relationType técnico (cajero_de_socio, jugador_de_cajero, …) a una
 * frase clara para el operador (docs/21 §4.3). Si hay nombre del padre, lo usa.
 */
function friendlyRelation(relationType: string, parentName?: string): string {
  const who = parentName ? ` de ${parentName}` : '';
  const map: Record<string, string> = {
    cajero_de_socio: `Es cajero${who}`,
    cajero_de_distribuidor: `Es cajero${who}`,
    distribuidor_de_socio: `Es distribuidor${who}`,
    jugador_de_socio: `Es jugador${who}`,
    jugador_de_distribuidor: `Es jugador${who}`,
    jugador_de_cajero: `Es jugador${who}`,
    empleado: `Es empleado${who}`,
    asignado_manual: parentName ? `Asignado manualmente a ${parentName}` : 'Asignado manualmente',
  };
  return map[relationType] ?? relationType.replace(/_/g, ' ');
}
