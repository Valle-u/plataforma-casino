/**
 * AccountMenu — menú de cuenta del header (avatar → dropdown).
 *
 * Recreado del handoff `handoff_lote_2/Menus header.dc.html`. Consolida cosas
 * que estaban dispersas: el botón de llave del header (cambiar contraseña) y
 * el logout del pie del sidebar.
 *
 * Contenido:
 *   - Cabecera: avatar + username + chip de rol + tenant.
 *   - Saldo: "Bankroll de la Casa" (admin) o "Mi billetera" (resto), con ojo
 *     para ocultar.
 *   - Accesos: Cambiar contraseña, Mi billetera, Mi sucursal, Configuración.
 *   - Densidad de tablas: Cómoda / Compacta (localStorage).
 *   - Cerrar sesión (rojo).
 */

'use client';

import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Settings,
  Store,
  Vault,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type ComponentType, type SVGProps } from 'react';
import { ChangeMyPasswordModal } from '@/components/admin/change-my-password-modal';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { hasPermission, isAdminTenant, useAuth } from '@/lib/auth-context';
import { useHouseState } from '@/lib/hooks/use-house';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useTableDensity } from '@/lib/table-density';
import { cn } from '@/lib/cn';

const ROLE_VARIANT: Record<string, BadgeVariant> = {
  admin_tenant: 'danger',
  socio: 'warning',
  distribuidor: 'info',
  cajero: 'info',
  empleado: 'neutral',
  usuario_final: 'neutral',
};

const ROLE_LABEL: Record<string, string> = {
  admin_tenant: 'Administrador',
  socio: 'Socio',
  distribuidor: 'Distribuidor',
  cajero: 'Cajero',
  empleado: 'Empleado',
  usuario_final: 'Jugador',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export function AccountMenu() {
  const { user, logout } = useAuth();
  const tenantInfo = useTenantInfo();
  const isAdmin = isAdminTenant(user);
  const [open, setOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [showBalance, setShowBalance] = useState(true);
  const [density, setDensity] = useTableDensity();

  const houseQuery = useHouseState();
  const walletQuery = useMyWallet();
  const balance = isAdmin ? houseQuery.data?.balance : walletQuery.data?.balance;
  const balanceLoading = isAdmin ? houseQuery.isLoading : walletQuery.isLoading;

  const name = user?.displayName || user?.username || 'Cuenta';
  const primaryRole = user?.roles?.[0];

  const canSeeBranch =
    user?.roles?.some((r) => ['socio', 'cajero', 'distribuidor'].includes(r)) ??
    false;
  const canSeeSettings = isAdmin || hasPermission(user, 'tenant.settings.edit');

  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 h-11 lg:h-9 pl-1.5 pr-2 rounded-[var(--radius-sm)] border transition-colors',
          open
            ? 'bg-[var(--color-bg-subtle)] border-[var(--color-border-strong)]'
            : 'bg-[var(--color-bg-elevated)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
        )}
      >
        <span className="size-[26px] shrink-0 rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)] flex items-center justify-center text-[11px] font-semibold">
          {initials(name)}
        </span>
        <span className="hidden sm:block max-w-[120px] truncate text-[12.5px] text-[var(--color-fg)]">
          {user?.username ?? name}
        </span>
        {open ? (
          <ChevronUp className="size-3.5 text-[var(--color-fg-muted)]" />
        ) : (
          <ChevronDown className="size-3.5 text-[var(--color-fg-subtle)]" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-[300px] rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[0_26px_60px_-18px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col"
          >
            {/* Cabecera */}
            <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
              <span className="size-10 shrink-0 rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)] flex items-center justify-center text-[15px] font-semibold">
                {initials(name)}
              </span>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[14px] font-semibold text-[var(--color-fg)] truncate">
                  {name}
                </span>
                <div className="flex items-center gap-2 min-w-0">
                  {primaryRole && (
                    <Badge variant={ROLE_VARIANT[primaryRole] ?? 'neutral'}>
                      {ROLE_LABEL[primaryRole] ?? primaryRole}
                    </Badge>
                  )}
                  {tenantInfo.data?.tenant.slug && (
                    <span className="text-[10.5px] font-mono text-[var(--color-fg-subtle)] truncate">
                      {tenantInfo.data.tenant.slug}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Saldo */}
            <div className="flex flex-col gap-2 p-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <Vault className="size-3.5 text-[var(--color-accent-text)]" />
                <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
                  {isAdmin ? 'Bankroll de la Casa' : 'Mi billetera'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowBalance((v) => !v)}
                  className="ml-auto text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
                  title={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}
                >
                  {showBalance ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4" />
                  )}
                </button>
              </div>
              <span className="font-display text-2xl tabular-nums tracking-tight text-[var(--color-fg)]">
                {showBalance ? (
                  balanceLoading ? (
                    <span className="opacity-50">…</span>
                  ) : balance ? (
                    Number(balance).toLocaleString('es-AR', {
                      maximumFractionDigits: 0,
                    })
                  ) : (
                    '—'
                  )
                ) : (
                  <span className="tracking-[0.2em]">••••••</span>
                )}
              </span>
            </div>

            {/* Accesos */}
            <div className="flex flex-col p-2 gap-0.5">
              <MenuButton
                icon={KeyRound}
                label="Cambiar mi contraseña"
                onClick={() => {
                  close();
                  setChangePwdOpen(true);
                }}
              />
              {!isAdmin && (
                <MenuLink
                  icon={Wallet}
                  label="Mi billetera"
                  href="/wallet"
                  onNavigate={close}
                />
              )}
              {canSeeBranch && (
                <MenuLink
                  icon={Store}
                  label="Mi sucursal"
                  href="/my-branch"
                  onNavigate={close}
                />
              )}
              {canSeeSettings && (
                <MenuLink
                  icon={Settings}
                  label="Configuración del casino"
                  href="/settings"
                  onNavigate={close}
                />
              )}
            </div>

            {/* Densidad de tablas */}
            <div className="flex flex-col gap-2 px-4 py-3 border-t border-[var(--color-border)]">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
                Densidad de las tablas
              </span>
              <div className="flex items-center gap-1 p-1 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)]">
                {(
                  [
                    ['comfortable', 'Cómoda'],
                    ['compact', 'Compacta'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDensity(value)}
                    className={cn(
                      'flex-1 h-8 rounded-md text-[12.5px] font-medium transition-colors',
                      density === value
                        ? 'bg-[var(--color-bg-subtle)] text-[var(--color-fg)] font-semibold'
                        : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Cerrar sesión */}
            <div className="p-2 border-t border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => {
                  close();
                  logout();
                }}
                className="flex items-center gap-3 w-full h-10 px-3 rounded-[var(--radius-sm)] text-[13.5px] font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors"
              >
                <LogOut className="size-4" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </>
      )}

      <ChangeMyPasswordModal open={changePwdOpen} onOpenChange={setChangePwdOpen} />
    </div>
  );
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 h-[42px] px-3 rounded-[var(--radius-sm)] text-[13.5px] text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
    >
      <Icon className="size-4 text-[var(--color-fg-muted)]" />
      <span className="flex-1 min-w-0 text-left truncate">{label}</span>
    </button>
  );
}

function MenuLink({
  icon: Icon,
  label,
  href,
  onNavigate,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  href: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-3 h-[42px] px-3 rounded-[var(--radius-sm)] text-[13.5px] text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
    >
      <Icon className="size-4 text-[var(--color-fg-muted)]" />
      <span className="flex-1 min-w-0 truncate">{label}</span>
    </Link>
  );
}
