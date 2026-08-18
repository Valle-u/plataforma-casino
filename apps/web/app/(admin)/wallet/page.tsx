/**
 * /wallet — wallet del operador logueado.
 *
 * Composición:
 *   - Header con título + meta del wallet (id, version, currency).
 *   - Hero balance: monto grande mono + locked balance al lado.
 *   - 3 botones: Destruir fichas (burn), Cargar a usuario (load),
 *     Retirar de usuario (unload). (El mint directo del admin se eliminó.)
 *   - Tabla de transactions paginada con type / amount / balance / reason.
 *
 * Sprint (fase 4 · UX): si el usuario es `admin_tenant`, la ruta redirige
 * automáticamente a `/tesoreria`. La wallet personal del admin está siempre
 * en 0 (el admin no opera con clientes: eso lo hacen sus cajeros/socios),
 * y su verdadera caja es la Casa. Ver `docs/16-tesoreria`.
 */

'use client';

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Coins,
  Flame,
  RefreshCw,
  ShieldCheck,
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
  // de carga es la corrección contra cupo. Ocultamos "Cargar a usuario".
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

  return (
    <>
      <PageShell className="gap-8">
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
          {/* Balance principal */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-8 flex flex-col gap-6 relative overflow-hidden">
            {/* Glow rojo decorativo en esquina */}
            <div
              aria-hidden
              className="absolute -top-24 -right-24 size-72 rounded-full opacity-30 blur-3xl"
              style={{ background: 'var(--color-accent-glow)' }}
            />

            <div className="relative flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
                Saldo disponible
              </span>
              {wallet.data && (
                <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
                  · {wallet.data.currency}
                </span>
              )}
            </div>

            <div className="relative flex items-baseline gap-3 min-h-[4rem]">
              {wallet.isLoading ? (
                <Skeleton className="h-14 w-64 bg-[var(--color-bg-subtle)]" />
              ) : wallet.isError ? (
                <span className="font-display text-3xl text-[var(--color-fg-subtle)]">
                  —
                </span>
              ) : (
                <>
                  <span className="font-display text-[2.5rem] lg:text-[4rem] leading-none tabular-nums tracking-tight text-[var(--color-fg)]">
                    {formatBalance(wallet.data?.balance ?? '0')}
                  </span>
                  <span className="text-sm font-mono text-[var(--color-fg-subtle)] uppercase tracking-[0.14em]">
                    fichas
                  </span>
                </>
              )}
            </div>

            <div className="relative flex flex-wrap items-center gap-4 lg:gap-6 text-[11px] text-[var(--color-fg-subtle)] uppercase tracking-[0.12em] pt-4 border-t border-[var(--color-border)]">
              <Meta
                icon={<ShieldCheck className="size-3" />}
                label="Bloqueado"
                value={wallet.data ? `${wallet.data.lockedBalance} fichas` : '—'}
              />
            </div>
          </div>

          {/* Acciones */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-6 flex flex-col gap-3">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium pb-2 border-b border-[var(--color-border)]">
              Acciones
            </span>

            {canBurn && (
              <ActionButton
                icon={Flame}
                title="Destruir fichas"
                hint="Saca fichas del sistema para siempre (queda registrado)"
                tone="danger"
                onClick={() => setBurnOpen(true)}
              />
            )}
            {!isEmpleadoActor && (
              <ActionButton
                icon={ArrowDownToLine}
                title="Cargar a un jugador"
                hint="Le pasás fichas de tu caja a la suya"
                tone="success"
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

        {/* ── Transactions ────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
              Movimientos · Página {page + 1}
              {txs.data && (
                <span className="ml-2 font-mono text-[var(--color-fg-subtle)]">
                  ({txs.data.total} total)
                </span>
              )}
            </h2>
            <Pager
              page={page}
              total={txs.data?.total ?? 0}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => p + 1)}
              hasMore={txs.data ? (page + 1) * PAGE_SIZE < txs.data.total : false}
            />
          </div>

          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
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

/** Tono del ícono según la acción ("un color = una acción"). */
const ACTION_TONE: Record<'success' | 'warning' | 'danger', string> = {
  success: 'text-[var(--color-success)] border-[var(--color-success)]/40 bg-[var(--color-success-bg)]',
  warning: 'text-[var(--color-warning)] border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)]',
  danger: 'text-[var(--color-danger)] border-[var(--color-danger)]/40 bg-[var(--color-danger-bg)]',
};

function ActionButton({
  icon: Icon,
  title,
  hint,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  tone: 'success' | 'warning' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 p-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors text-left"
    >
      <div
        className={cn(
          'size-9 shrink-0 rounded-[var(--radius-sm)] border flex items-center justify-center transition-colors',
          ACTION_TONE[tone],
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">{title}</div>
        <div className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</div>
      </div>
    </button>
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
          {TX_TYPE_LABEL[tx.type] ?? tx.type}
        </Badge>
      </TD>
      <TD numeric>
        <span
          className={cn(
            isCredit
              ? 'text-[var(--color-success)]'
              : 'text-[var(--color-fg-muted)]',
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

function Meta({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1">
        {icon}
        <span>{label}</span>
      </span>
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
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end}`}
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
// Sprint 51.10: actividad reciente del operador (KPIs + breakdown)
// ──────────────────────────────────────────────────────────────────────

const TX_TYPE_LABEL: Record<string, string> = {
  mint: 'Crear fichas',
  burn: 'Destruir fichas',
  load: 'Cargas hechas',
  unload: 'Retiros hechos',
  transfer_in: 'Recibidos',
  transfer_out: 'Enviados',
  deposit_credit: 'Depósitos acreditados',
  withdrawal_debit: 'Retiros debitados',
  cashback_credit: 'Cashback',
  bonus_funding: 'Fondeo bonos',
  bonus_funding_revert: 'Reversión bono',
  bonus_clear: 'Bono limpiado',
  promo_reward: 'Premios promo',
  win: 'Ganancias juego',
  bet: 'Apuestas',
};

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

  const minted = sumByType('mint');
  const burned = sumByType('burn');
  const loaded = sumByType('load');
  const unloaded = sumByType('unload');

  const netNum = Number(stats?.netChange ?? '0');
  const isNetPositive = netNum >= 0;

  // Max para barras horizontales del breakdown.
  const maxSum = byType.reduce((acc, r) => Math.max(acc, Number(r.sum)), 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
          Tu actividad · últimos {windowDays} días
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
                'px-3 h-7 text-[11px] uppercase tracking-[0.08em] font-medium',
                'transition-colors duration-150',
                windowDays === d
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && !stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-[92px] w-full rounded-[var(--radius)] bg-[var(--color-bg-subtle)]"
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
        <>
          {/* Tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <KpiTile
              label="Fichas creadas"
              icon={Coins}
              value={formatBalance(String(minted))}
              hint={minted > 0 ? 'entraron al sistema' : 'ninguna'}
              tone={minted > 0 ? 'success' : 'default'}
            />
            <KpiTile
              label="Fichas destruidas"
              icon={Flame}
              value={formatBalance(String(burned))}
              hint={burned > 0 ? 'salieron del sistema' : 'ninguna'}
              tone={burned > 0 ? 'danger' : 'default'}
            />
            <KpiTile
              label="Cargado a jugadores"
              icon={ArrowDownToLine}
              value={formatBalance(String(loaded))}
              hint={
                unloaded > 0
                  ? `- ${formatBalance(String(unloaded))} retirados`
                  : 'sin retiros'
              }
              tone={loaded > 0 ? 'accent' : 'default'}
            />
            <KpiTile
              label={`Neto (${windowDays}d)`}
              icon={TrendingUp}
              value={(isNetPositive ? '+' : '') + formatBalance(String(netNum))}
              hint={`cambio en los últimos ${windowDays === 7 ? '7 días' : `${windowDays} días`}`}
              tone={
                netNum === 0
                  ? 'default'
                  : isNetPositive
                    ? 'success'
                    : 'danger'
              }
            />
          </div>

          {/* Breakdown por tipo */}
          {byType.length > 0 && (
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto p-4 flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
                Distribución por tipo
              </div>
              <div className="flex flex-col gap-1.5 mt-1">
                {byType.slice(0, 8).map((row) => {
                  const pct = maxSum > 0 ? (Number(row.sum) / maxSum) * 100 : 0;
                  return (
                    <div
                      key={row.type}
                      className="grid grid-cols-[100px_1fr_70px_40px] lg:grid-cols-[140px_1fr_90px_50px] items-center gap-2 lg:gap-3 text-[11px]"
                    >
                      <span className="text-[var(--color-fg)] truncate">
                        {TX_TYPE_LABEL[row.type] ?? row.type}
                      </span>
                      <div className="h-2 rounded-full bg-[var(--color-bg-subtle)] relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)] transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono tabular-nums text-right text-[var(--color-fg-muted)]">
                        {formatBalance(row.sum)}
                      </span>
                      <span className="font-mono tabular-nums text-right text-[var(--color-fg-subtle)]">
                        {row.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
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
