/**
 * /wallet — wallet del operador logueado (cajero o socio).
 *
 * Recreado del handoff `handoff_lote_2/Mi billetera.dc.html`:
 *   - Hero de saldo con degradado + glow lima; línea inferior con Bloqueado
 *     y Último movimiento.
 *   - Panel "Qué querés hacer": Cargar (verde) / Retirar (ámbar) / Destruir
 *     (roja, con borde propio porque es irreversible).
 *   - "Tu actividad": ventana 7/30/90 + cinco tiles (Movimientos, Cambio
 *     neto, Cargado, Retirado, Fichas destruidas).
 *   - Movimientos: chip con ícono y color por tipo, monto con signo desde
 *     la perspectiva de la caja del operador (Carga −, Descarga +).
 *
 * Signo (perspectiva de la caja del operador): cargarle a un jugador le
 * RESTA fichas a su caja (−), retirarle le SUMA (+). Ver README §3.
 *
 * Fase 4 · UX: si el usuario es `admin_tenant`, la ruta redirige a
 * `/tesoreria` (su caja es la Casa; su wallet personal está siempre en 0).
 */

'use client';

import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpToLine,
  Clock,
  Coins,
  Flame,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LoadUnloadModal,
  type LoadUnloadMode,
} from '@/components/admin/load-unload-modal';
import { MintBurnModal } from '@/components/admin/mint-burn-modal';
import {
  hasPermission,
  isAdminTenant,
  useAuth,
} from '@/lib/auth-context';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { KpiTile } from '@/components/ui/kpi-tile';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import {
  useMyTransactions,
  useMyWallet,
  useMyWalletStats,
  type MyWalletStatsResponse,
  type WalletTransaction,
} from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

/**
 * Créditos a la caja del operador (entra plata → +, verde). El resto son
 * débitos (sale plata → −, rojo). Desde la perspectiva del operador:
 * cargarle a un jugador es un débito; retirarle es un crédito.
 */
const CREDIT_TYPES = new Set([
  'unload',
  'transfer_in',
  'deposit_credit',
  'cashback_credit',
  'mint',
  'bonus_clear',
  'bonus_funding_revert',
  'win',
]);

/** Color del chip (identidad del tipo, no dirección de la plata). */
const TX_TYPE_VARIANT: Record<string, BadgeVariant> = {
  mint: 'success',
  burn: 'danger',
  bonus_funding: 'info',
  bonus_funding_revert: 'neutral',
  bonus_clear: 'success',
  load: 'success',
  transfer_in: 'info',
  transfer_out: 'warning',
  unload: 'warning',
  deposit_credit: 'success',
  withdrawal_debit: 'warning',
  cashback_credit: 'success',
};

/** Etiqueta en criollo del movimiento (las 4 principales, del handoff). */
const TX_TYPE_LABEL: Record<string, string> = {
  load: 'Carga',
  unload: 'Descarga',
  transfer_in: 'Transferencia entrante',
  transfer_out: 'Transferencia saliente',
  burn: 'Destrucción',
  mint: 'Creación',
  deposit_credit: 'Depósito acreditado',
  withdrawal_debit: 'Retiro debitado',
  cashback_credit: 'Cashback',
  bonus_funding: 'Fondeo de bono',
  bonus_funding_revert: 'Reversión de bono',
  bonus_clear: 'Bono liberado',
  win: 'Ganancia',
  bet: 'Apuesta',
};

/** Ícono del chip por tipo. */
const TX_TYPE_ICON: Record<string, LucideIcon> = {
  load: ArrowDownToLine,
  unload: ArrowUpToLine,
  transfer_in: ArrowDownLeft,
  transfer_out: ArrowUpToLine,
  burn: Flame,
  mint: Coins,
  deposit_credit: ArrowDownToLine,
  withdrawal_debit: ArrowUpToLine,
  cashback_credit: Coins,
};

export default function WalletPage() {
  const { user: actor } = useAuth();
  const router = useRouter();
  const adminMode = isAdminTenant(actor);

  // Fase 4: para el admin_tenant, /wallet redirige a /tesoreria. Su caja es
  // la Casa (docs/16). La wallet personal del admin es de sistema (siempre 0),
  // no operativa — mostrarla como "tu wallet" confunde al operador.
  useEffect(() => {
    if (adminMode) {
      router.replace('/tesoreria');
    }
  }, [adminMode, router]);

  // Burn solo se muestra a quien tenga el permiso efectivo. (El mint directo
  // del admin se eliminó; las fichas se crean vía aporte de capital a la Casa.)
  const canBurn = hasPermission(actor, 'wallet.burn');
  // docs/19 (LEYES R7): el rol empleado NO usa wallet.load — su único canal
  // de carga es la corrección contra cupo. Ocultamos "Cargar a un jugador".
  const isEmpleadoActor = actor?.roles?.includes('empleado') === true;
  const wallet = useMyWallet();
  const [page, setPage] = useState(0);
  const txs = useMyTransactions(PAGE_SIZE, page * PAGE_SIZE);
  // Sprint 51.10: stats de la actividad propia del operador. Ventana
  // configurable — default 7 días, suficientemente granular para el
  // panel del cajero/socio sin abrumar.
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(7);
  const stats = useMyWalletStats(windowDays);
  const [burnOpen, setBurnOpen] = useState(false);
  const [loadUnloadModal, setLoadUnloadModal] = useState<LoadUnloadMode | null>(
    null,
  );

  const balanceZero = Number(wallet.data?.balance ?? '0') === 0;
  const lastMovement = txs.data?.data?.[0]?.createdAt
    ? formatRelative(txs.data.data[0].createdAt)
    : '—';

  return (
    <>
      <PageShell className="gap-6">
        <PageHeader
          icon={Wallet}
          title="Mi billetera"
          description="Tu caja personal de fichas: desde acá le cargás fichas a tus jugadores y les retirás cuando corresponde."
          actions={
            <>
              <CsvExportButton
                path="/tenant/wallet/me/transactions/export"
                filenameHint="wallet_transactions"
                permission="wallet.export"
                entityLabel="transacciones"
              />
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  wallet.refetch();
                  txs.refetch();
                  stats.refetch();
                }}
                disabled={wallet.isFetching || txs.isFetching || stats.isFetching}
              >
                <RefreshCw
                  className={cn(
                    'size-3.5',
                    (wallet.isFetching || txs.isFetching || stats.isFetching) &&
                      'animate-spin',
                  )}
                />
                Refrescar
              </Button>
            </>
          }
        />

        <HelpNote id="wallet">
          Tu billetera es tu <strong>caja de fichas</strong>. El{' '}
          <strong>saldo disponible</strong> es lo que tenés para{' '}
          <strong>cargarle a un jugador</strong> (le pasás fichas de tu caja a la
          suya). Cuando un jugador quiere sacar, <strong>le retirás</strong>{' '}
          fichas y vuelven a tu caja. El saldo <strong>bloqueado</strong> son
          fichas reservadas por una operación en curso. Abajo ves tu{' '}
          <strong>actividad</strong> y el detalle de cada movimiento.
        </HelpNote>

        {/* ── Hero balance ────────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
          {/* Balance principal — degradado + glow lima (handoff) */}
          <div
            className="relative overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] p-7 flex flex-col gap-5"
            style={{
              background:
                'linear-gradient(150deg, #141a10, var(--color-bg-elevated) 55%)',
            }}
          >
            <div
              aria-hidden
              className="absolute -top-24 -right-20 size-64 rounded-full blur-[60px]"
              style={{ background: 'rgba(201,242,77,.12)' }}
            />

            <div className="relative flex items-center gap-2">
              <span className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-semibold">
                Saldo disponible
              </span>
              <span className="text-[10.5px] font-mono text-[var(--color-fg-subtle)]">
                · {wallet.data?.currency ?? 'FICHAS'}
              </span>
            </div>

            <div className="relative flex items-baseline gap-3 min-h-[3.5rem]">
              {wallet.isLoading ? (
                <Skeleton className="h-14 w-64 bg-[var(--color-bg-subtle)]" />
              ) : wallet.isError ? (
                <span className="font-display text-3xl text-[var(--color-fg-subtle)]">
                  —
                </span>
              ) : (
                <>
                  <span className="font-display text-[2.75rem] lg:text-[3.75rem] leading-none tabular-nums tracking-[-0.02em] text-[var(--color-fg)]">
                    {formatBalance(wallet.data?.balance ?? '0')}
                  </span>
                  <span className="text-xs font-mono text-[var(--color-fg-subtle)] uppercase tracking-[0.14em]">
                    fichas
                  </span>
                </>
              )}
            </div>

            <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 pt-4 border-t border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-3.5 text-[var(--color-warning)]" />
                <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold">
                  Bloqueado
                </span>
                <span className="text-[13px] font-mono tabular-nums text-[var(--color-fg)]">
                  {wallet.data ? formatBalance(wallet.data.lockedBalance) : '—'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="size-3.5 text-[var(--color-fg-muted)]" />
                <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold">
                  Último movimiento
                </span>
                <span className="text-[13px] font-mono tabular-nums text-[var(--color-fg-muted)]">
                  {lastMovement}
                </span>
              </div>
            </div>
          </div>

          {/* Qué querés hacer */}
          <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5 flex flex-col gap-2.5">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-semibold pb-2.5 border-b border-[var(--color-border)]">
              Qué querés hacer
            </span>

            {!isEmpleadoActor && (
              <ActionButton
                icon={ArrowDownToLine}
                title="Cargar a un jugador"
                hint={
                  balanceZero
                    ? 'Necesitás saldo para poder cargar'
                    : 'Le pasás fichas de tu caja a la suya'
                }
                tone="success"
                disabled={balanceZero}
                onClick={() => setLoadUnloadModal('load')}
              />
            )}
            <ActionButton
              icon={ArrowUpToLine}
              title="Retirar de un jugador"
              hint="Traés fichas de su caja a la tuya"
              tone="warning"
              onClick={() => setLoadUnloadModal('unload')}
            />
            {canBurn && (
              <ActionButton
                icon={Flame}
                title="Destruir fichas"
                hint="Saca fichas del sistema para siempre y queda registrado"
                tone="danger"
                onClick={() => setBurnOpen(true)}
              />
            )}
          </div>
        </section>

        {/* ── Actividad reciente (KPIs propios) ───────────────── */}
        <ActivitySection
          stats={stats.data}
          loading={stats.isLoading}
          isFetching={stats.isFetching}
          isError={stats.isError}
          windowDays={windowDays}
          onWindowDaysChange={setWindowDays}
        />

        {/* ── Movimientos ─────────────────────────────────────── */}
        <section className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="font-display text-lg tracking-tight text-[var(--color-fg)]">
                Movimientos
              </h2>
              {txs.data && (
                <span className="font-mono text-[12px] text-[var(--color-fg-subtle)]">
                  {txs.data.total} en total
                </span>
              )}
            </div>
            <Pager
              page={page}
              total={txs.data?.total ?? 0}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => p + 1)}
              hasMore={txs.data ? (page + 1) * PAGE_SIZE < txs.data.total : false}
            />
          </div>

          <div className="overflow-x-auto">
            {txs.isLoading ? (
              <SkeletonTable rows={6} columns={[0.12, 0.1, 0.15, 0.35, 0.12]} />
            ) : txs.isError ? (
              <div className="p-6">
                <EmptyState
                  hint="transactions"
                  label="No se pudo cargar el historial."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => txs.refetch()}
                    >
                      Reintentar
                    </Button>
                  }
                />
              </div>
            ) : !txs.data || txs.data.data.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  hint="transactions"
                  label="Tu billetera no tiene movimientos todavía"
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Tipo</TH>
                    <TH align="right">Monto</TH>
                    <TH align="right">Saldo después</TH>
                    <TH>Motivo</TH>
                    <TH align="right">Fecha</TH>
                  </tr>
                </THead>
                <TBody>
                  {txs.data.data.map((tx, i) => (
                    <TxRow key={tx.id} tx={tx} index={i} />
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </section>
      </PageShell>

      {/* Modal abre aunque wallet.data sea null — el backend re-valida el
       * balance al hacer el mint/burn. */}
      {burnOpen && (
        <MintBurnModal
          open={burnOpen}
          onOpenChange={setBurnOpen}
          currentBalance={wallet.data?.balance ?? '0'}
        />
      )}

      {loadUnloadModal && actor && (
        <LoadUnloadModal
          mode={loadUnloadModal}
          open={!!loadUnloadModal}
          onOpenChange={(o) => !o && setLoadUnloadModal(null)}
          actorUserId={actor.id}
        />
      )}
    </>
  );
}

/** Tinte del cuadrado de ícono según la acción ("un color = una acción"). */
const ACTION_TONE_ICON: Record<'success' | 'warning' | 'danger', string> = {
  success: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
};

function ActionButton({
  icon: Icon,
  title,
  hint,
  tone,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  tone: 'success' | 'warning' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}) {
  // La destructiva lleva borde y fondo rojo propio porque es irreversible.
  const emphasized = tone === 'danger';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex items-center gap-3 p-3.5 rounded-[var(--radius-sm)] border text-left transition-colors',
        disabled && 'opacity-50 pointer-events-none',
        emphasized
          ? 'border-[var(--color-danger)]/25 bg-[var(--color-danger)]/[0.04] hover:border-[var(--color-danger)]/45'
          : 'border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-border-strong)]',
      )}
    >
      <div
        className={cn(
          'size-9 shrink-0 rounded-[var(--radius-sm)] flex items-center justify-center',
          ACTION_TONE_ICON[tone],
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'text-[13px] tracking-tight',
            emphasized
              ? 'text-[var(--color-danger)] font-semibold'
              : 'text-[var(--color-fg)]',
          )}
        >
          {title}
        </div>
        <div className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</div>
      </div>
    </button>
  );
}

function TxRow({ tx, index }: { tx: WalletTransaction; index: number }) {
  const variant = TX_TYPE_VARIANT[tx.type] ?? 'neutral';
  const Icon = TX_TYPE_ICON[tx.type] ?? ReceiptText;
  const isCredit = CREDIT_TYPES.has(tx.type);
  const sign = isCredit ? '+' : '−';
  return (
    <TR
      className="animate-fade-up-staggered"
      style={{ animationDelay: `${Math.min(index * 25, 500)}ms` }}
    >
      <TD>
        <Badge variant={variant}>
          <Icon className="size-3" />
          {TX_TYPE_LABEL[tx.type] ?? tx.type}
        </Badge>
      </TD>
      <TD numeric>
        <span
          className={cn(
            'font-mono',
            isCredit
              ? 'text-[var(--color-success)]'
              : 'text-[var(--color-danger)]',
          )}
        >
          {sign} {tx.amount}
        </span>
      </TD>
      <TD numeric className="text-[var(--color-fg-muted)]">
        {tx.balanceAfter}
      </TD>
      <TD className="max-w-[400px]">
        <span
          className="text-[12px] text-[var(--color-fg-muted)] truncate block"
          title={tx.reason ?? undefined}
        >
          {tx.reason ?? '—'}
        </span>
      </TD>
      <TD numeric className="text-[var(--color-fg-subtle)]">
        {formatDateTime(tx.createdAt)}
      </TD>
    </TR>
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
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)] rounded-[var(--radius-sm)] overflow-hidden">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:hover:bg-[var(--color-bg-elevated)] disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:hover:bg-[var(--color-bg-elevated)] disabled:cursor-not-allowed transition-colors"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function formatBalance(balance: string): string {
  // "1234567.89" → "1,234,567.89"
  const [int, dec] = balance.split('.');
  const withCommas = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${withCommas}.${dec}` : withCommas;
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.10: actividad reciente del operador (cinco tiles del handoff)
// ──────────────────────────────────────────────────────────────────────

function ActivitySection({
  stats,
  loading,
  isFetching,
  isError,
  windowDays,
  onWindowDaysChange,
}: {
  stats: MyWalletStatsResponse | undefined;
  loading: boolean;
  isFetching: boolean;
  isError: boolean;
  windowDays: 7 | 30 | 90;
  onWindowDaysChange: (d: 7 | 30 | 90) => void;
}) {
  const byType = stats?.byType ?? [];
  const sumByType = (type: string): number => {
    const row = byType.find((r) => r.type === type);
    return row ? Number(row.sum) : 0;
  };
  const countByType = (type: string): number => {
    const row = byType.find((r) => r.type === type);
    return row ? row.count : 0;
  };

  const loaded = sumByType('load');
  const unloaded = sumByType('unload');
  const burned = sumByType('burn');

  const netNum = Number(stats?.netChange ?? '0');
  const isNetPositive = netNum >= 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-semibold">
          Tu actividad
          {stats && (
            <span className="ml-2 font-mono text-[var(--color-fg-subtle)] normal-case tracking-normal">
              ({stats.totalTransactions} movimientos)
            </span>
          )}
        </h2>
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] rounded-[var(--radius-sm)] overflow-hidden self-start">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onWindowDaysChange(d)}
              className={cn(
                'px-3.5 h-7 text-[12px] font-medium transition-colors duration-150',
                windowDays === d
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {d} días
            </button>
          ))}
        </div>
      </div>

      {loading && !stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-[104px] w-full rounded-[var(--radius)] bg-[var(--color-bg-subtle)]"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="px-3 py-2 rounded-[var(--radius-sm)] text-[11px] text-[var(--color-danger)] bg-[var(--color-danger-subtle)] border border-[var(--color-danger-border)]">
          No se pudieron cargar las estadísticas de actividad.
        </div>
      ) : (
        <div className="relative">
          {/* Fetching overlay when switching window (7d/30d/90d) */}
          {isFetching && !loading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--color-bg)]/60 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                <Spinner size="sm" />
                <span className="uppercase tracking-[0.08em]">Actualizando…</span>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <KpiTile
              label="Movimientos"
              icon={ReceiptText}
              value={String(stats?.totalTransactions ?? 0)}
              hint={`en los últimos ${windowDays} días`}
            />
            <KpiTile
              label="Cambio neto"
              icon={isNetPositive ? TrendingUp : TrendingDown}
              value={(isNetPositive ? '+' : '') + formatBalance(String(netNum))}
              hint={
                netNum === 0
                  ? 'sin cambios'
                  : isNetPositive
                    ? 'entró más de lo que salió'
                    : 'salió más de lo que entró'
              }
              tone={netNum === 0 ? 'default' : isNetPositive ? 'success' : 'danger'}
            />
            <KpiTile
              label="Cargado a jugadores"
              icon={ArrowDownToLine}
              value={formatBalance(String(loaded))}
              hint={`${countByType('load')} cargas`}
              tone={loaded > 0 ? 'success' : 'default'}
            />
            <KpiTile
              label="Retirado de jugadores"
              icon={ArrowUpToLine}
              value={formatBalance(String(unloaded))}
              hint={`${countByType('unload')} retiros`}
              tone={unloaded > 0 ? 'warning' : 'default'}
            />
            <KpiTile
              label="Fichas destruidas"
              icon={Flame}
              value={formatBalance(String(burned))}
              hint={burned > 0 ? 'salieron del sistema' : 'sin destrucciones'}
              tone={burned > 0 ? 'danger' : 'default'}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** "hace 8 min" / "hace 3 h" / "hace 2 d" para el Último movimiento. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMin = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (diffMin < 1) return 'recién';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}
