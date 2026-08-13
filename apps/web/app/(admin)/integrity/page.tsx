/**
 * /integrity — "Integridad y seguridad".
 *
 * Unifica dos controles del sistema en una sola sección con pestañas:
 *   - Integridad de fichas (ex /ledger): que el saldo de cada billetera
 *     coincida con sus movimientos (LEY E2).
 *   - Cuentas duplicadas (ex /fraud): detectar la misma persona con varias
 *     cuentas (misma IP / email parecido).
 * Cada pestaña se muestra solo si el usuario tiene el permiso (P1). Arriba, una
 * tira de estado que resume ambas de un vistazo.
 */

'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { LedgerPanel } from '@/components/admin/ledger-panel';
import { FraudPanel } from '@/components/admin/fraud-panel';
import { MovementAlertsPanel } from '@/components/admin/movement-alerts-panel';
import { Skeleton } from '@/components/ui/skeleton';
import { hasPermission, useAuth } from '@/lib/auth-context';
import { useLatestReconciliation } from '@/lib/hooks/use-ledger';
import { useFraudStats } from '@/lib/hooks/use-fraud';
import { useMovementAlertStats } from '@/lib/hooks/use-movement-alerts';
import { cn } from '@/lib/cn';

type TabId = 'ledger' | 'fraud' | 'movements';

export default function IntegrityPage() {
  const { user } = useAuth();
  const canLedger = hasPermission(user, 'ledger.view');
  const canFraud =
    hasPermission(user, 'fraud.view') ||
    hasPermission(user, 'fraud.review') ||
    hasPermission(user, 'fraud.run_scan');
  const canMov = hasPermission(user, 'mov_alerts.view');

  const tabs: { id: TabId; label: string }[] = [];
  if (canLedger) tabs.push({ id: 'ledger', label: 'Integridad de fichas' });
  if (canFraud) tabs.push({ id: 'fraud', label: 'Cuentas duplicadas' });
  if (canMov) tabs.push({ id: 'movements', label: 'Movimientos sospechosos' });

  const [tab, setTab] = useState<TabId>(
    canLedger ? 'ledger' : canFraud ? 'fraud' : 'movements',
  );

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-2 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <ShieldCheck className="size-3" />
          Núcleo · Control
        </span>
        <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
          Integridad y seguridad
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1 max-w-2xl">
          Acá controlás dos cosas: que <strong>las fichas del sistema cuadren</strong>{' '}
          (nada aparece ni desaparece sin registro) y que{' '}
          <strong>no haya cuentas duplicadas</strong> abusando de bonos o promos.
        </p>
      </header>

      {/* Tira de estado */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {canLedger && <LedgerStatusTile onGo={() => setTab('ledger')} />}
        {canFraud && <FraudStatusTile onGo={() => setTab('fraud')} />}
        {canMov && <MovStatusTile onGo={() => setTab('movements')} />}
      </div>

      {/* Pestañas */}
      {tabs.length > 1 && (
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 h-9 text-[12px] tracking-[0.02em] font-medium transition-colors duration-150',
                tab === t.id
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Contenido */}
      {tab === 'ledger' && canLedger && <LedgerPanel />}
      {tab === 'fraud' && canFraud && <FraudPanel />}
      {tab === 'movements' && canMov && <MovementAlertsPanel />}
    </div>
  );
}

function MovStatusTile({ onGo }: { onGo: () => void }) {
  const statsQ = useMovementAlertStats();
  if (statsQ.isLoading) return <Skeleton className="h-[76px]" />;
  const pending = statsQ.data?.suspected ?? 0;
  if (pending > 0) {
    return (
      <StatusTile
        icon={<ShieldAlert className="size-6" />}
        title="Movimientos sospechosos"
        status={`${pending} por revisar`}
        detail="Alertas de fraude interno esperando tu decisión."
        tone="warn"
        onGo={onGo}
      />
    );
  }
  return (
    <StatusTile
      icon={<ShieldCheck className="size-6" />}
      title="Movimientos sospechosos"
      status="Sin pendientes"
      detail="No hay movimientos sospechosos por revisar."
      tone="ok"
      onGo={onGo}
    />
  );
}

// ── Tiles de estado ────────────────────────────────────────────────────────

function StatusTile({
  icon,
  title,
  status,
  detail,
  tone,
  onGo,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  detail: string;
  tone: 'ok' | 'warn' | 'neutral';
  onGo: () => void;
}) {
  const toneCls =
    tone === 'ok'
      ? 'text-[var(--color-success)]'
      : tone === 'warn'
        ? 'text-[var(--color-accent-text)]'
        : 'text-[var(--color-fg-muted)]';
  return (
    <button
      type="button"
      onClick={onGo}
      className="text-left bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex items-start gap-3 hover:bg-[var(--color-bg-subtle)] transition-colors"
    >
      <span className={cn('shrink-0 mt-0.5', toneCls)}>{icon}</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
          {title}
        </span>
        <span className={cn('text-[15px] font-medium', toneCls)}>{status}</span>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          {detail}
        </span>
      </div>
    </button>
  );
}

function LedgerStatusTile({ onGo }: { onGo: () => void }) {
  const latest = useLatestReconciliation();
  if (latest.isLoading) return <Skeleton className="h-[76px]" />;
  const run = latest.data?.run ?? null;

  if (!run) {
    return (
      <StatusTile
        icon={<Coins className="size-6" />}
        title="Fichas"
        status="Sin chequeos aún"
        detail="Corré el chequeo en la pestaña de fichas."
        tone="neutral"
        onGo={onGo}
      />
    );
  }
  const mismatches = run.walletsMismatched + run.holdsMismatched;
  if (run.status === 'error') {
    return (
      <StatusTile
        icon={<XCircle className="size-6" />}
        title="Fichas"
        status="El último chequeo falló"
        detail="Revisá el detalle en la pestaña de fichas."
        tone="warn"
        onGo={onGo}
      />
    );
  }
  if (mismatches > 0) {
    return (
      <StatusTile
        icon={<AlertTriangle className="size-6" />}
        title="Fichas"
        status={`Hay ${mismatches} descuadre(s)`}
        detail="Tocá para ver qué billeteras no cuadran."
        tone="warn"
        onGo={onGo}
      />
    );
  }
  return (
    <StatusTile
      icon={<CheckCircle2 className="size-6" />}
      title="Fichas"
      status="Todo cuadra"
      detail={`${run.walletsChecked} billeteras revisadas.`}
      tone="ok"
      onGo={onGo}
    />
  );
}

function FraudStatusTile({ onGo }: { onGo: () => void }) {
  const statsQ = useFraudStats();
  if (statsQ.isLoading) return <Skeleton className="h-[76px]" />;
  const pending = statsQ.data?.suspectedLinks ?? 0;

  if (pending > 0) {
    return (
      <StatusTile
        icon={<ShieldAlert className="size-6" />}
        title="Cuentas duplicadas"
        status={`${pending} por revisar`}
        detail="Coincidencias sospechosas esperando tu decisión."
        tone="warn"
        onGo={onGo}
      />
    );
  }
  return (
    <StatusTile
      icon={<ShieldCheck className="size-6" />}
      title="Cuentas duplicadas"
      status="Sin pendientes"
      detail="No hay coincidencias sospechosas por revisar."
      tone="ok"
      onGo={onGo}
    />
  );
}
