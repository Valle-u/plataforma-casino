/**
 * NotificationsBell — campana del header + panel de avisos.
 *
 * Recreado del handoff `handoff_lote_2/Menus header.dc.html`. No inventa
 * back nuevo: arma el panel leyendo contadores que el panel ya calcula.
 *
 *   Necesitan tu decisión (accionables, con contador y CTA):
 *     - Depósitos esperando      (cola de /deposits)
 *     - Retiros por pagar        (/withdrawals aprobados sin transferir)
 *     - Transferencias sin matchear (/bank-transactions)
 *     - Cuentas duplicadas       (fraud links suspected)
 *   Para que estés al tanto (informativos, solo admin):
 *     - Proveedores en mantenimiento / catálogo sincronizado
 *
 * El badge muestra la cantidad de avisos accionables. No hay "marcar
 * leídos" persistente (eso sí necesitaría back nuevo).
 */

'use client';

import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Bell,
  CheckCheck,
  Link2,
  Plug,
  RefreshCw,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { hasPermission, isAdminTenant, useAuth } from '@/lib/auth-context';
import { useDeposits } from '@/lib/hooks/use-deposits';
import { useWithdrawals } from '@/lib/hooks/use-withdrawals';
import { useBankTransactions } from '@/lib/hooks/use-bank-transactions';
import { useFraudStats } from '@/lib/hooks/use-fraud';
import { useGameProviders } from '@/lib/hooks/use-game-providers';
import { formatArDateTime } from '@/lib/format-date';
import { cn } from '@/lib/cn';

type Tone = 'success' | 'danger' | 'warning' | 'info';

const TONE_ICON: Record<Tone, string> = {
  success: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
  danger: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
  warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
  info: 'bg-[var(--color-info-bg)] text-[var(--color-info)]',
};

interface Notice {
  key: string;
  title: string;
  body: string;
  icon: LucideIcon;
  tone: Tone;
  href: string;
  cta: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function NotificationsBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const canDeposits =
    hasPermission(user, 'deposits.view') ||
    hasPermission(user, 'deposits.view_all');
  const canWithdrawals =
    hasPermission(user, 'withdrawals.view') ||
    hasPermission(user, 'withdrawals.view_all');
  const canBankTx = hasPermission(user, 'bank_tx.view');
  const canFraud =
    hasPermission(user, 'fraud.view') || hasPermission(user, 'fraud.review');
  const isAdmin = isAdminTenant(user);

  const deposits = useDeposits(
    { status: ['pending', 'under_review'], limit: 1 },
    { enabled: canDeposits },
  );
  const withdrawals = useWithdrawals(
    { status: ['approved'], limit: 1 },
    { enabled: canWithdrawals },
  );
  const bankTx = useBankTransactions(
    { status: 'unmatched', limit: 1 },
    { enabled: canBankTx },
  );
  const fraud = useFraudStats({ enabled: canFraud });

  const depCount = canDeposits ? (deposits.data?.total ?? 0) : 0;
  const witCount = canWithdrawals ? (withdrawals.data?.total ?? 0) : 0;
  const btCount = canBankTx ? (bankTx.data?.total ?? 0) : 0;
  const fraudCount = canFraud ? (fraud.data?.suspectedLinks ?? 0) : 0;

  const notices: Notice[] = [];
  if (depCount > 0) {
    notices.push({
      key: 'deposits',
      title: plural(depCount, 'depósito esperando', 'depósitos esperando'),
      body: 'Pendientes de aprobar en la cola.',
      icon: ArrowDownToLine,
      tone: 'success',
      href: '/deposits',
      cta: 'Revisar cola',
    });
  }
  if (witCount > 0) {
    notices.push({
      key: 'withdrawals',
      title: plural(witCount, 'retiro por pagar', 'retiros por pagar'),
      body: 'Aprobados y todavía sin transferir.',
      icon: ArrowUpFromLine,
      tone: 'danger',
      href: '/withdrawals',
      cta: 'Ir a retiros',
    });
  }
  if (btCount > 0) {
    notices.push({
      key: 'bank-tx',
      title: plural(
        btCount,
        'transferencia sin matchear',
        'transferencias sin matchear',
      ),
      body: 'Cargadas del banco, todavía sin cruzar con una carga o retiro.',
      icon: Link2,
      tone: 'info',
      href: '/bank-transactions',
      cta: 'Matchear',
    });
  }
  if (fraudCount > 0) {
    notices.push({
      key: 'fraud',
      title: plural(
        fraudCount,
        'cuenta duplicada por revisar',
        'cuentas duplicadas por revisar',
      ),
      body: 'Posibles multicuentas detectadas por el control de integridad.',
      icon: ShieldAlert,
      tone: 'warning',
      href: '/integrity',
      cta: 'Ver coincidencias',
    });
  }

  const badge = notices.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Avisos"
        aria-expanded={open}
        className={cn(
          'relative size-9 rounded-[var(--radius-sm)] flex items-center justify-center transition-colors',
          open
            ? 'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]'
            : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)]',
        )}
      >
        <Bell className="size-4" />
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)] text-[10px] font-bold flex items-center justify-center">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(412px,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[0_26px_60px_-18px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[min(640px,80vh)]"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--color-border)]">
              <span className="font-display text-[17px] tracking-tight text-[var(--color-fg)]">
                Avisos
              </span>
              {badge > 0 ? (
                <span className="h-[22px] px-2 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] text-[11px] font-bold flex items-center">
                  {badge} {badge === 1 ? 'nuevo' : 'nuevos'}
                </span>
              ) : (
                <span className="ml-auto text-[12px] text-[var(--color-fg-subtle)]">
                  Al día
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {notices.length > 0 ? (
                <>
                  <GroupHeader label="Necesitan tu decisión" />
                  {notices.map((n) => (
                    <NoticeRow
                      key={n.key}
                      notice={n}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </>
              ) : (
                <EmptyState />
              )}

              {isAdmin && <ProviderNotices />}
            </div>

            {/* Footer */}
            <Link
              href="/audit"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg)] text-[12.5px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
            >
              Ver el registro de actividad
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </span>
      <span className="flex-1 h-px bg-[var(--color-border)]" />
    </div>
  );
}

function NoticeRow({
  notice,
  onNavigate,
}: {
  notice: Notice;
  onNavigate: () => void;
}) {
  const Icon = notice.icon;
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-t border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)] transition-colors">
      <div
        className={cn(
          'size-[34px] shrink-0 rounded-[var(--radius-sm)] flex items-center justify-center',
          TONE_ICON[notice.tone],
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="text-[13.5px] font-semibold text-[var(--color-fg)]">
          {notice.title}
        </span>
        <span className="text-[12.5px] text-[var(--color-fg-muted)] leading-snug">
          {notice.body}
        </span>
        <Link
          href={notice.href}
          onClick={onNavigate}
          className={cn(
            'mt-1 self-start inline-flex items-center gap-1.5 h-[30px] px-3 rounded-[var(--radius-sm)] text-[12px] font-bold transition-[filter] hover:brightness-110',
            TONE_ICON[notice.tone],
          )}
        >
          {notice.cta}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-9 text-center">
      <div className="size-[52px] rounded-[var(--radius-lg)] bg-[var(--color-success-bg)] text-[var(--color-success)] flex items-center justify-center">
        <CheckCheck className="size-6" />
      </div>
      <span className="font-display text-[17px] tracking-tight text-[var(--color-fg)]">
        No hay nada esperando
      </span>
      <span className="text-[12.5px] text-[var(--color-fg-muted)] leading-relaxed max-w-[280px]">
        Ninguna solicitud pendiente y ningún control con alertas. Si entra algo,
        te avisa acá.
      </span>
    </div>
  );
}

/** Grupo informativo (solo admin): estado de los proveedores de juego. */
function ProviderNotices() {
  const { data } = useGameProviders();
  const providers = (data ?? []).filter((p) => p.isEnabled);

  const maintenance = providers.filter((p) => p.maintenanceMode);
  const lastSync = providers
    .filter((p) => p.lastSyncAt && p.lastSyncOk)
    .sort((a, b) => (a.lastSyncAt! < b.lastSyncAt! ? 1 : -1))[0];

  if (maintenance.length === 0 && !lastSync) return null;

  return (
    <>
      <GroupHeader label="Para que estés al tanto" />
      {maintenance.map((p) => (
        <InfoRow
          key={`maint-${p.code}`}
          icon={Plug}
          tone="warning"
          title={`${p.displayName} quedó en mantenimiento`}
          body="Sus juegos no se muestran al jugador"
        />
      ))}
      {lastSync && (
        <InfoRow
          icon={RefreshCw}
          tone="info"
          title={`Catálogo de ${lastSync.displayName} sincronizado`}
          body={
            lastSync.lastSyncAt
              ? formatArDateTime(lastSync.lastSyncAt)
              : 'Al día'
          }
        />
      )}
    </>
  );
}

function InfoRow({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-t border-[var(--color-border)]">
      <div
        className={cn(
          'size-[30px] shrink-0 rounded-[var(--radius-sm)] flex items-center justify-center',
          TONE_ICON[tone],
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-[13px] text-[var(--color-fg)] truncate">
          {title}
        </span>
        <span className="text-[11.5px] text-[var(--color-fg-subtle)] truncate">
          {body}
        </span>
      </div>
    </div>
  );
}
