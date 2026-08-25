/**
 * UserActionsCell — acciones operativas por usuario.
 *
 * Sprint 51.10: acciones inline por fila (cargar, retirar, corrección,
 * bono, bloquear) + menú "⋯" con ver perfil / editar / impersonar /
 * reset password. Toda la lógica de permisos y modals vive acá.
 *
 * Sprint 55.x (mobile): `variant="sheet"` reemplaza los iconos chicos
 * por un botón full-width que abre un ActionSheet iOS-style con las
 * mismas acciones listadas en vertical (tap targets >= 44px).
 *
 * Desktop NO cambia: `variant="inline"` conserva los botones icono
 * size-7 + menú flotante.
 */

'use client';

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Ban,
  ExternalLink,
  Gift,
  KeyRound,
  LogIn,
  MoreVertical,
  Pencil,
  Store,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { EditUserModal } from '@/components/admin/edit-user-modal';
import { ResetPasswordModal } from '@/components/admin/reset-password-modal';
import { GrantBonusModal } from '@/components/admin/grant-bonus-modal';
import { RemoveBonusModal } from '@/components/admin/remove-bonus-modal';
import { CorrectionModal } from '@/components/admin/correction-modal';
import { LoadUnloadModal, type LoadUnloadMode } from '@/components/admin/load-unload-modal';
import { ActionSheet } from '@/components/ui/action-sheet';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import { Button } from '@/components/ui/button';
import { isAdminTenant, isIndependentBranch, useAuth } from '@/lib/auth-context';
import type { TenantUserRow } from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';

export type UserActionsVariant = 'inline' | 'sheet' | 'list';

interface UserActionsCellProps {
  user: TenantUserRow;
  onSuccess?: () => void;
  variant?: UserActionsVariant;
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral';

interface ActionEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: Tone;
  visible: boolean;
  /** Si está presente, el ítem es un Link en vez de un botón. */
  href?: string;
  onClick?: () => void;
}

/** Color de ícono para los ítems del ActionSheet. */
const SHEET_ICON_TONE: Record<Tone, string> = {
  success: 'text-[var(--color-success)]',
  warning: 'text-[var(--color-warning)]',
  danger: 'text-[var(--color-danger)]',
  info: 'text-[var(--color-info)]',
  accent: 'text-[var(--color-accent-text)]',
  neutral: 'text-[var(--color-fg-muted)]',
};

/** Label rojo solo para acciones destructivas en el sheet. */
const SHEET_LABEL_DANGER: Tone[] = ['danger'];

/**
 * Botones "pill" con label del row desktop / card mobile (handoff): las
 * acciones de plata primarias se muestran con fondo tenue + label, no como
 * íconos fantasma. Cargar/Vender = verde (entra), Retirar = rojo (sale),
 * Corrección = azul. El resto del quick-row (Otorgar bono) va como ícono
 * neutro, igual que el gift del handoff.
 *
 * Nota: "Retirar" es ROJO en el botón compacto (par +/− del handoff) y
 * ÁMBAR en el sheet/menú (tone 'warning'), tal cual el handoff.
 */
const PILL_KEY_TONE: Record<string, 'success' | 'danger' | 'info'> = {
  load: 'success',
  sell: 'success',
  correction: 'info',
  unload: 'danger',
};
const PILL_TONE_CLASS: Record<'success' | 'danger' | 'info', string> = {
  success: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
  danger: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-bg)] text-[var(--color-info)]',
};
/** Label corto del pill (el completo queda como title/tooltip). */
const PILL_LABEL: Record<string, string> = {
  load: 'Cargar',
  sell: 'Vender',
  correction: 'Corrección',
  unload: 'Retirar',
};

/** Orden de los ítems dentro del ActionSheet. */
const SHEET_ORDER: string[] = [
  'view',
  'load',
  'unload',
  'sell',
  'correction',
  'bonus',
  'remove-bonus',
  'block',
  'edit',
  'impersonate',
  'reset',
];

export function UserActionsCell({
  user,
  onSuccess,
  variant = 'inline',
}: UserActionsCellProps) {
  const { user: actor, impersonate } = useAuth();
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [removeBonusOpen, setRemoveBonusOpen] = useState(false);
  const [blockModal, setBlockModal] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [loadModal, setLoadModal] = useState<LoadUnloadMode | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [impersonateConfirm, setImpersonateConfirm] = useState(false);
  // Motivo: input NO controlado (ref) para que tipear no re-renderice la celda.
  // Un textarea controlado (value/onChange) re-renderizaba en cada tecla y en
  // algunos navegadores (Opera) el input perdía el foco → saltaba a la X.
  const interveneReasonRef = useRef<HTMLTextAreaElement>(null);
  const [impersonating, setImpersonating] = useState(false);

  const updateMenuPos = useCallback(() => {
    if (!menuBtnRef.current) return;
    const rect = menuBtnRef.current.getBoundingClientRect();
    const MENU_HEIGHT = 180;
    const MARGIN = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < MENU_HEIGHT) {
      setMenuPos({ top: rect.top - MENU_HEIGHT - MARGIN, right: window.innerWidth - rect.right });
    } else {
      setMenuPos({ top: rect.bottom + MARGIN, right: window.innerWidth - rect.right });
    }
  }, []);

  useEffect(() => {
    if (menuOpen) {
      updateMenuPos();
      window.addEventListener('scroll', updateMenuPos, true);
      return () => window.removeEventListener('scroll', updateMenuPos, true);
    }
  }, [menuOpen, updateMenuPos]);

  const isEmpleadoActor = actor?.roles?.includes('empleado') === true;
  // docs/19 (LEYES R7): el empleado NO usa wallet.load — su único canal de
  // carga es la corrección contra cupo. Ocultamos el botón por rol (además
  // del backend 403 EMPLOYEE_LOAD_BLOCKED) para no mostrar una acción que
  // siempre falla.
  const canLoad =
    !isEmpleadoActor &&
    (actor?.effectivePermissions === undefined ||
      actor.effectivePermissions.includes('wallet.load'));
  // Carga por corrección: SOLO empleados de la red central (rol 'empleado',
  // rama dependiente). El admin carga con wallet.load (tesorería) y los
  // socios independientes venden fichas por /branches (docs/19).
  const canCorrect =
    isEmpleadoActor &&
    !isAdminTenant(actor) &&
    !isIndependentBranch(actor) &&
    (actor.effectivePermissions?.includes('wallet.correct') ?? false);
  const canUnload =
    actor?.effectivePermissions === undefined ||
    actor.effectivePermissions.includes('wallet.unload');
  // Impersonar es capacidad de admin (permiso `users.impersonate`, que por seed
  // solo tiene admin_tenant; no delegable). Se gatea por permiso (LEYES P1) para
  // que el boton solo aparezca donde el backend lo permite. El OR con
  // isAdminTenant es resguardo por si effectivePermissions llega vacio.
  const canImpersonate =
    !!actor &&
    actor.id !== user.id &&
    !actor.impersonatedBy &&
    (isAdminTenant(actor) || actor.effectivePermissions?.includes('users.impersonate') === true);
  // 2026-07: la wallet de bonos es exclusiva de usuarios finales (LEYES). Y
  // además el actor necesita el permiso de otorgar bono manual (el backend lo
  // exige: bonuses.grant_manual, o el bypass _admin_network del comodín); un
  // operador dependiente no lo tiene → el botón le daría 403.
  const canBonus =
    user.roleCodes.includes('usuario_final') &&
    (actor?.effectivePermissions?.includes('bonuses.grant_manual') === true ||
      actor?.effectivePermissions?.includes(
        'bonuses.grant_manual_admin_network',
      ) === true);

  const handleImpersonate = () => {
    setSheetOpen(false);
    setMenuOpen(false);
    if (user.isIndependentBranch || user.underIndependentBranch) {
      setImpersonateConfirm(true);
    } else {
      impersonate(user.id).then((impersonatedUser) => {
        window.location.href = impersonatedUser.canAccessPanel ? '/dashboard' : '/play';
      }).catch(() => {
        toast.error('No se pudo impersonar');
      });
    }
  };

  // Ítems que en desktop son botones icono directos.
  const quick: ActionEntry[] = [
    {
      key: 'load',
      label: 'Cargar fichas',
      icon: ArrowDownToLine,
      tone: 'success',
      visible: canLoad && actor?.id !== user.id && !user.isIndependentBranch,
      onClick: () => setLoadModal('load'),
    },
    {
      key: 'sell',
      label: 'Venderle fichas',
      icon: Store,
      tone: 'success',
      visible: !!user.isIndependentBranch,
      href: '/branches',
    },
    {
      key: 'correction',
      label: 'Carga por corrección',
      icon: Wrench,
      tone: 'info',
      visible: canCorrect && actor?.id !== user.id && !user.isIndependentBranch,
      onClick: () => setCorrectionOpen(true),
    },
    {
      key: 'unload',
      label: 'Retirar fichas',
      icon: ArrowUpToLine,
      tone: 'warning',
      visible: canUnload && actor?.id !== user.id,
      onClick: () => setLoadModal('unload'),
    },
    {
      key: 'bonus',
      label: 'Otorgar bono',
      icon: Gift,
      tone: 'accent',
      visible: canBonus,
      onClick: () => setBonusOpen(true),
    },
  ];

  // Ítems que en desktop viven dentro del menú "⋯" (y en el sheet mobile).
  // Orden handoff: navegación → destructivas al final.
  const menu: ActionEntry[] = [
    {
      key: 'view',
      label: 'Ver perfil',
      icon: ExternalLink,
      tone: 'neutral',
      visible: true,
      href: `/users/${user.id}`,
    },
    {
      key: 'edit',
      label: 'Editar usuario',
      icon: Pencil,
      tone: 'neutral',
      visible: true,
      onClick: () => setEditOpen(true),
    },
    {
      key: 'impersonate',
      label: 'Impersonar',
      icon: UserRound,
      // Handoff: Impersonar en azul/info (operar como el usuario).
      tone: 'info',
      visible: canImpersonate,
      onClick: handleImpersonate,
    },
    {
      key: 'reset',
      label: 'Cambiar contraseña',
      icon: KeyRound,
      tone: 'neutral',
      visible: true,
      onClick: () => setResetPwOpen(true),
    },
    {
      key: 'remove-bonus',
      label: 'Quitar bono',
      icon: Gift,
      tone: 'danger',
      visible: canBonus,
      onClick: () => setRemoveBonusOpen(true),
    },
    {
      key: 'block',
      label: 'Bloquear usuario',
      icon: Ban,
      tone: 'danger',
      visible: user.status !== 'banned',
      onClick: () => setBlockModal(true),
    },
  ];

  // Variante 'list': lista vertical de botones con etiqueta, inline (sin hoja
  // ni portal). Ideal para paneles laterales (mapa de red) en desktop.
  if (variant === 'list') {
    const listItems = SHEET_ORDER.map((key) =>
      [...quick, ...menu].find((e) => e.key === key),
    ).filter((e): e is ActionEntry => !!e && e.visible);

    return (
      <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
        {listItems.map((item) => {
          const Icon = item.icon;
          const inner = (
            <>
              <Icon className={cn('size-4 shrink-0', SHEET_ICON_TONE[item.tone])} />
              <span
                className={cn(
                  'text-[13px]',
                  SHEET_LABEL_DANGER.includes(item.tone)
                    ? 'text-[var(--color-danger)]'
                    : 'text-[var(--color-fg)]',
                )}
              >
                {item.label}
              </span>
            </>
          );
          const rowClass =
            'w-full h-10 flex items-center gap-2.5 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-left transition-colors hover:border-[var(--color-border-strong)]';
          return item.href ? (
            <Link key={item.key} href={item.href} className={rowClass}>
              {inner}
            </Link>
          ) : (
            <button
              key={item.key}
              type="button"
              className={rowClass}
              onClick={() => item.onClick?.()}
            >
              {inner}
            </button>
          );
        })}
        {renderSharedModals()}
      </div>
    );
  }

  if (variant === 'sheet') {
    const sheetItems = SHEET_ORDER
      .map((key) => [...quick, ...menu].find((e) => e.key === key))
      .filter((e): e is ActionEntry => !!e && e.visible);

    // Fila del handoff (card mobile): [Cargar][Retirar] como pills + [⋮] que
    // abre el sheet con el resto de las acciones.
    const moneyActions = quick.filter((e) => e.visible && PILL_KEY_TONE[e.key]);
    const inAction = moneyActions.find((e) => e.key !== 'unload');
    const outAction = moneyActions.find((e) => e.key === 'unload');
    const renderPill = (entry: ActionEntry) => {
      const Icon = entry.icon;
      const cls = cn(
        'flex-1 h-12 inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] text-[14px] font-semibold whitespace-nowrap transition-[filter] hover:brightness-110',
        PILL_TONE_CLASS[PILL_KEY_TONE[entry.key]!],
      );
      const label = PILL_LABEL[entry.key] ?? entry.label;
      return entry.href ? (
        <Link href={entry.href} className={cls}>
          <Icon className="size-4" />
          {label}
        </Link>
      ) : (
        <button type="button" onClick={entry.onClick} className={cls}>
          <Icon className="size-4" />
          {label}
        </button>
      );
    };

    return (
      <div onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          {inAction && renderPill(inAction)}
          {outAction && renderPill(outAction)}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="Más opciones"
            className={cn(
              'h-12 shrink-0 inline-flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)] transition-colors',
              inAction || outAction ? 'w-12' : 'flex-1',
            )}
          >
            <MoreVertical className="size-5" />
          </button>
        </div>

        <ActionSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={`@${user.username}`}
          subtitle={user.displayName || user.username}
          footer={
            <Button
              variant="secondary"
              size="md"
              className="w-full h-12"
              onClick={() => setSheetOpen(false)}
            >
              Cancelar
            </Button>
          }
        >
          <div className="flex flex-col">
            {sheetItems.map((item) => {
              const Icon = item.icon;
              const inner = (
                <>
                  <Icon className={cn('size-4 shrink-0', SHEET_ICON_TONE[item.tone])} />
                  <span
                    className={cn(
                      'text-[14px]',
                      SHEET_LABEL_DANGER.includes(item.tone)
                        ? 'text-[var(--color-danger)]'
                        : 'text-[var(--color-fg)]',
                    )}
                  >
                    {item.label}
                  </span>
                </>
              );
              const rowClass =
                'w-full h-12 flex items-center gap-3 px-3 text-left transition-colors hover:bg-[var(--color-bg-subtle)]';
              return item.href ? (
                <Link
                  key={item.key}
                  href={item.href}
                  className={rowClass}
                  onClick={() => setSheetOpen(false)}
                >
                  {inner}
                </Link>
              ) : (
                <button
                  key={item.key}
                  type="button"
                  className={rowClass}
                  onClick={() => {
                    setSheetOpen(false);
                    item.onClick?.();
                  }}
                >
                  {inner}
                </button>
              );
            })}
          </div>
        </ActionSheet>

        {renderSharedModals()}
      </div>
    );
  }

  // Slots fijos para alinear las columnas entre filas (paz visual): la acción
  // de plata "entrante" (Cargar/Vender/Corrección), la "saliente" (Retirar),
  // el Bono (o un hueco si el usuario no lo admite) y el menú ⋮. Cada slot
  // ocupa el mismo ancho tenga o no botón, así Cargar y Retirar caen siempre
  // en la misma vertical.
  const inAction = quick.find(
    (e) => e.visible && e.key !== 'unload' && PILL_KEY_TONE[e.key],
  );
  const outAction = quick.find((e) => e.visible && e.key === 'unload');
  const bonusAction = quick.find((e) => e.visible && e.key === 'bonus');

  const renderInlinePill = (entry: ActionEntry) => {
    const Icon = entry.icon;
    const pillClass = cn(
      'inline-flex items-center justify-center gap-1.5 h-8 w-[92px] rounded-md text-[12px] font-semibold whitespace-nowrap transition-[filter] hover:brightness-110',
      PILL_TONE_CLASS[PILL_KEY_TONE[entry.key]!],
    );
    const label = PILL_LABEL[entry.key] ?? entry.label;
    return entry.href ? (
      <Link href={entry.href} className={pillClass} title={entry.label}>
        <Icon className="size-3.5" />
        {label}
      </Link>
    ) : (
      <button type="button" onClick={entry.onClick} className={pillClass} title={entry.label}>
        <Icon className="size-3.5" />
        {label}
      </button>
    );
  };

  return (
    <div
      className="flex items-center justify-end gap-1 relative"
      onClick={(e) => e.stopPropagation()}
    >
      {inAction ? renderInlinePill(inAction) : <span className="w-[92px]" aria-hidden />}
      {outAction ? renderInlinePill(outAction) : <span className="w-[92px]" aria-hidden />}
      {bonusAction ? (
        <button
          type="button"
          onClick={bonusAction.onClick}
          className="inline-flex items-center justify-center size-8 rounded-md bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)] transition-colors"
          title={bonusAction.label}
        >
          <Gift className="size-4" />
        </button>
      ) : (
        <span className="size-8" aria-hidden />
      )}

      {/* Menú "⋯" */}
      <div className="relative">
        <button
          ref={menuBtnRef}
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="inline-flex items-center justify-center size-8 rounded-md bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)] transition-colors"
          title="Más opciones"
        >
          <MoreVertical className="size-4" />
        </button>

        {menuOpen &&
          createPortal(
            <>
              <div
                className="fixed inset-0 z-[9998]"
                onClick={() => setMenuOpen(false)}
              />
              <div
                className="fixed z-[9999] w-52 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border)] shadow-xl py-1.5"
                style={{ top: menuPos.top, right: menuPos.right }}
              >
                {menu.filter((e) => e.visible).map((entry) => {
                  const Icon = entry.icon;
                  const isDanger = SHEET_LABEL_DANGER.includes(entry.tone);
                  const rowClass = cn(
                    'flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-[var(--color-bg-subtle)] transition-colors',
                    isDanger ? 'text-[var(--color-danger)]' : 'text-[var(--color-fg)]',
                  );
                  const iconClass = cn('size-3.5', SHEET_ICON_TONE[entry.tone]);
                  if (entry.href) {
                    return (
                      <Link
                        key={entry.key}
                        href={entry.href}
                        className={rowClass}
                        onClick={() => setMenuOpen(false)}
                      >
                        <Icon className={iconClass} />
                        {entry.label}
                      </Link>
                    );
                  }
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        entry.onClick?.();
                      }}
                      className={`w-full text-left ${rowClass}`}
                    >
                      <Icon className={iconClass} />
                      {entry.label}
                    </button>
                  );
                })}
              </div>
            </>,
            document.body,
          )}
      </div>

      {/* Llamado como función (no <SharedModals/>): un componente anidado se
          re-crea en cada render y REMONTA los modales, reseteando su estado
          (ej: el modal se "cerraba" al scrollear/re-renderizar). Como función,
          su JSX se inlinea y los modales mantienen su identidad. */}
      {renderSharedModals()}
    </div>
  );

  function renderSharedModals() {
    return (
      <>
        <CorrectionModal
          open={correctionOpen}
          onOpenChange={setCorrectionOpen}
          targetUserId={user.id}
          targetUsername={user.username}
          targetDisplayName={user.displayName || user.username}
          onSuccess={onSuccess}
        />

        {actor && loadModal && (
          <LoadUnloadModal
            mode={loadModal}
            open
            onOpenChange={(o) => !o && setLoadModal(null)}
            presetTargetUser={user}
            actorUserId={actor.id}
            onSuccess={onSuccess}
          />
        )}

        <GrantBonusModal
          open={bonusOpen}
          onOpenChange={setBonusOpen}
          actorUserId={actor?.id ?? ''}
          presetTargetUser={user}
        />

        <RemoveBonusModal
          open={removeBonusOpen}
          onOpenChange={setRemoveBonusOpen}
          targetUser={user}
          bonusBalance={user.bonusBalance}
        />

        <EditUserModal
          open={editOpen}
          onOpenChange={setEditOpen}
          userId={user.id}
          username={user.username}
          currentDisplayName={user.displayName || user.username}
          currentEmail={user.email}
        />

        <ResetPasswordModal
          open={resetPwOpen}
          onOpenChange={setResetPwOpen}
          targetUserId={user.id}
          targetUsername={user.username}
          targetDisplayName={user.displayName || user.username}
          actorHasTwoFa={!!actor?.twoFaEnabled}
        />

        <ConfirmWithReasonModal
          open={blockModal}
          onOpenChange={setBlockModal}
          title="Bloquear usuario"
          description={`El usuario @${user.username} no podrá iniciar sesión.`}
          warning="Esta acción deshabilita la cuenta. Queda en audit log permanente."
          confirmLabel="Bloquear"
          reasonPlaceholder="Ej: Cuenta duplicada, fraude..."
          onConfirm={async (reason) => {
            try {
              const res = await fetch(`/api/tenant/users/${user.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'banned' }),
              });
              if (!res.ok) throw new Error('Failed');
              toast.success('Usuario bloqueado', {
                description: `@${user.username} fue bloqueado. Razón: ${reason}`,
              });
              setBlockModal(false);
              onSuccess?.();
            } catch {
              toast.error('No se pudo bloquear');
            }
          }}
        />

        <ConfirmModal
          open={impersonateConfirm}
          onOpenChange={(o) => {
            setImpersonateConfirm(o);
            if (!o && interveneReasonRef.current) interveneReasonRef.current.value = '';
          }}
          title={`¿Impersonar a @${user.username}?`}
          description="Vas a operar como este usuario hasta que vuelvas atrás."
          warning="Intervención en sub-red independiente: severidad crítica."
          confirmLabel="Impersonar"
          confirmIcon={<LogIn className="size-3.5" />}
          confirmVariant="outline-accent"
          isPending={impersonating}
          onConfirm={async () => {
            const reason = interveneReasonRef.current?.value.trim() ?? '';
            if (!reason) {
              toast.error('Debés escribir un motivo para intervenir una sub-red independiente.');
              return;
            }
            setImpersonating(true);
            try {
              const target = await impersonate(user.id, reason);
              window.location.href = target.canAccessPanel ? '/dashboard' : '/play';
            } catch {
              toast.error('No se pudo impersonar');
            } finally {
              setImpersonating(false);
            }
          }}
        >
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
        </ConfirmModal>
      </>
    );
  }
}
