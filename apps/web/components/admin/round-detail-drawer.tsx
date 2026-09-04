/**
 * RoundDetailDrawer — el detalle completo de UNA ronda.
 *
 * Por qué existe: hasta ahora la tabla de rondas mostraba el `round_external_id`
 * cortado a 14 caracteres, y todo lo demás que la base guarda para auditar
 * —el tipo de ronda, el resultado crudo del proveedor, el motivo de cierre
 * automático, los movimientos de fichas, el id de transacción del proveedor—
 * no se veía por ningún lado. Para reclamarle una jugada a un proveedor había
 * que exportar el CSV, y aun así faltaba la mitad.
 *
 * Todo lo que muestra ya estaba guardado. Esto sólo lo saca a la pantalla.
 *
 * Sigue el patrón de `deposit-detail-drawer` y `withdrawal-detail-drawer`.
 */

'use client';

import { Coins, Copy, Dices, FileJson, Server } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useRoundDetail,
  type ProviderTxRow,
  type RoundWalletTx,
} from '@/lib/hooks/use-game-stats';
import { cn } from '@/lib/cn';

interface Props {
  /** Id interno de la ronda. `null` = drawer cerrado. */
  roundId: string | null;
  onClose: () => void;
}

/** Nombres de proveedor en castellano, para no mostrar el código pelado. */
const PROVEEDOR: Record<string, string> = {
  palace: 'Palace',
  forever: 'Forever',
  gregmorn: 'Gregmorn',
};

/**
 * Qué fue la ronda. El dato existe desde la migración 0106 y nunca se mostró:
 * sin él, una compra de tiradas gratis se ve idéntica a un giro común —- un
 * `bet` grande y después premios sin apuesta que los explique.
 */
const TIPO_RONDA: Record<string, { texto: string; ayuda: string }> = {
  spin: { texto: 'Giro común', ayuda: 'Una jugada normal.' },
  bonus_buy: {
    texto: 'Compró la feature',
    ayuda:
      'El jugador PAGÓ para entrar a la ronda de bonus. Por eso la apuesta es alta.',
  },
  free_spins: {
    texto: 'Tiradas gratis',
    ayuda:
      'Corrió tiradas gratis sin comprarlas: se dispararon solas. Puede haber premio sin apuesta que lo explique.',
  },
};

export function RoundDetailDrawer({ roundId, onClose }: Props) {
  const { data, isLoading, error } = useRoundDetail(roundId);
  const [verPayload, setVerPayload] = useState(false);

  const r = data?.round;

  return (
    <Drawer
      open={Boolean(roundId)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Detalle de la ronda"
      header={
        r ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <Dices className="size-4 shrink-0 text-[var(--color-fg-muted)]" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-[var(--color-fg)]">
                {r.gameName}
              </div>
              <div className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                {PROVEEDOR[r.providerCode] ?? r.providerCode} · {r.username}
              </div>
            </div>
            <EstadoBadge status={r.status} outcome={r.outcome} />
          </div>
        ) : undefined
      }
    >
      {isLoading && (
        <div className="space-y-2 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {error && !isLoading && (
        <EmptyState
          label="No se pudo abrir la ronda"
          description="Puede que no exista, o que esté fuera de tu red."
        />
      )}

      {r && (
        <div className="space-y-5 pb-6">
          {/* ── Identificadores: lo que se le manda al proveedor ───────── */}
          <section>
            <SectionHeader
              label="Identificadores"
              icon={<Server className="size-3 text-[var(--color-fg-muted)]" />}
            />
            <Fila
              label="ID en el proveedor"
              value={r.roundExternalId}
              copy
              destacado
            />
            <Fila label="ID interno" value={r.id} copy />
            <Fila label="Sesión" value={r.sessionId} copy />
            {data.session?.providerSessionId && (
              <Fila
                label="Sesión (proveedor)"
                value={data.session.providerSessionId}
                copy
              />
            )}
            <Fila label="Jugador" value={`${r.displayName} (${r.username})`} />
            <Fila label="Juego" value={`${r.gameName} · ${r.gameCode}`} copy />
          </section>

          {/* ── Qué pasó ───────────────────────────────────────────────── */}
          <section>
            <SectionHeader
              label="Qué pasó"
              icon={<Dices className="size-3 text-[var(--color-fg-muted)]" />}
            />
            <Fila
              label="Tipo de ronda"
              valueNode={<TipoRonda action={r.action} />}
            />
            <Fila label="Apostó" value={r.betAmount} />
            <Fila label="Ganó" value={r.winAmount} />
            <Fila
              label="Neto"
              value={r.netAmount}
              tone={Number(r.netAmount) < 0 ? 'warning' : 'default'}
            />
            {r.balanceAfter && (
              <Fila label="Saldo tras apostar" value={r.balanceAfter} />
            )}
            <Fila label="Apostada" value={fecha(r.placedAt)} />
            <Fila
              label="Cerrada"
              value={r.settledAt ? fecha(r.settledAt) : 'Todavía abierta'}
            />
            {r.rolledBackAt && (
              <Fila
                label="Revertida"
                value={fecha(r.rolledBackAt)}
                tone="warning"
              />
            )}
            {r.autoSettledReason && (
              <Fila
                label="Cierre automático"
                tone="warning"
                valueNode={
                  <div className="text-[12px] text-[var(--color-warning)]">
                    <div className="font-mono">{r.autoSettledReason}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                      La cerramos nosotros, no el proveedor.
                    </div>
                  </div>
                }
              />
            )}
          </section>

          {/* ── Movimientos de fichas ──────────────────────────────────── */}
          <section>
            <SectionHeader
              label="Movimientos de fichas"
              icon={<Coins className="size-3 text-[var(--color-fg-muted)]" />}
            />
            <Movimiento etiqueta="Apuesta" tx={data.walletTxs.bet} />
            <Movimiento etiqueta="Premio" tx={data.walletTxs.win} />
            <Movimiento etiqueta="Reversa" tx={data.walletTxs.rollback} />
            {!data.walletTxs.bet &&
              !data.walletTxs.win &&
              !data.walletTxs.rollback && <Vacio>Sin movimientos ligados.</Vacio>}
          </section>

          {/* ── Lo que mandó el proveedor ──────────────────────────────── */}
          <section>
            <SectionHeader
              label={`Transacciones de ${PROVEEDOR[r.providerCode] ?? r.providerCode}`}
              icon={<Server className="size-3 text-[var(--color-fg-muted)]" />}
            />
            {data.providerTxs.length === 0 ? (
              <Vacio>
                Sin filas del proveedor para este round id. Puede ser una ronda
                vieja, o un proveedor que no guarda tabla propia.
              </Vacio>
            ) : (
              data.providerTxs.map((tx) => (
                <ProviderTx key={`${tx.idLabel}-${tx.externalId}`} tx={tx} />
              ))
            )}
          </section>

          {/* ── El resultado crudo ─────────────────────────────────────── */}
          <section>
            <SectionHeader
              label="Resultado crudo del proveedor"
              icon={<FileJson className="size-3 text-[var(--color-fg-muted)]" />}
            />
            {esVacio(r.payload) ? (
              <Vacio>Este proveedor no mandó detalle del resultado.</Vacio>
            ) : (
              <div className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setVerPayload((v) => !v)}
                  className="text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
                >
                  {verPayload ? 'Ocultar' : 'Ver'} el JSON completo
                </button>
                {verPayload && (
                  <>
                    <pre className="mt-2 max-h-[320px] overflow-auto rounded-md bg-[var(--color-bg-subtle)] p-3 text-[11px] leading-relaxed font-mono text-[var(--color-fg)]">
                      {JSON.stringify(r.payload, null, 2)}
                    </pre>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(
                          JSON.stringify(r.payload, null, 2),
                        );
                        toast.success('Copiado');
                      }}
                      className="mt-2 text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors"
                    >
                      Copiar el JSON
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

/* ────────────────────────── piezas ────────────────────────── */

function EstadoBadge({
  status,
  outcome,
}: {
  status: string;
  outcome: 'win' | 'loss' | 'zero';
}) {
  if (status === 'rolled_back')
    return <Badge variant="danger">Revertida</Badge>;
  if (status === 'placed') return <Badge variant="warning">Abierta</Badge>;
  const v: BadgeVariant =
    outcome === 'win' ? 'success' : outcome === 'loss' ? 'neutral' : 'neutral';
  return (
    <Badge variant={v}>
      {outcome === 'win' ? 'Ganó' : outcome === 'loss' ? 'Perdió' : 'Sin neto'}
    </Badge>
  );
}

function TipoRonda({ action }: { action: string | null }) {
  if (!action)
    return (
      <span className="text-[12px] text-[var(--color-fg-subtle)]">
        Sin dato — este proveedor no lo informa.
      </span>
    );
  const t = TIPO_RONDA[action];
  if (!t)
    return (
      <span className="font-mono text-[12.5px] text-[var(--color-fg)]">
        {action}
      </span>
    );
  return (
    <div>
      <div className="text-[12.5px] text-[var(--color-fg)]">{t.texto}</div>
      <div className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
        {t.ayuda}
      </div>
    </div>
  );
}

function Movimiento({
  etiqueta,
  tx,
}: {
  etiqueta: string;
  tx: RoundWalletTx | null;
}) {
  if (!tx) return null;
  return (
    <div className="border-b border-[var(--color-border)] px-4 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="w-[130px] shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
          {etiqueta}
        </span>
        <span className="flex-1 font-mono text-[12.5px] text-[var(--color-fg)]">
          {tx.amount}
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          saldo {tx.balanceAfter}
        </span>
        <CopyButton value={tx.id} />
      </div>
      <div className="mt-1 pl-[138px] text-[11px] text-[var(--color-fg-subtle)]">
        {tx.type}
        {tx.reason ? ` · ${tx.reason}` : ''} · {fecha(tx.createdAt)}
      </div>
    </div>
  );
}

function ProviderTx({ tx }: { tx: ProviderTxRow }) {
  const extras = Object.entries(tx.extra).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  return (
    <div className="border-b border-[var(--color-border)] px-4 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="w-[130px] shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
          {tx.idLabel}
        </span>
        <span
          className="flex-1 min-w-0 truncate font-mono text-[12.5px] text-[var(--color-fg)]"
          title={tx.externalId}
        >
          {tx.externalId || '—'}
        </span>
        {tx.externalId && <CopyButton value={tx.externalId} />}
      </div>
      <div className="mt-1 pl-[138px] text-[11px] text-[var(--color-fg-subtle)]">
        {tx.amount ? `${tx.amount} · ` : ''}
        {tx.kind ? `tipo ${tx.kind} · ` : ''}
        {fecha(tx.createdAt)}
        {extras.length > 0 && (
          <span className="ml-1">
            ·{' '}
            {extras
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] pb-2">
      {icon}
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-muted)]">
        {label}
      </span>
    </div>
  );
}

function Fila({
  label,
  value,
  valueNode,
  copy,
  tone,
  destacado,
}: {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  copy?: boolean;
  tone?: 'default' | 'warning';
  /** Resalta la fila: se usa para el id que se le manda al proveedor. */
  destacado?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2.5 last:border-b-0',
        destacado && 'bg-[var(--color-bg-subtle)]',
      )}
    >
      <span className="w-[130px] shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <div className="min-w-0 flex-1">
        {valueNode ?? (
          <span
            className={cn(
              'block truncate font-mono text-[12.5px]',
              tone === 'warning'
                ? 'text-[var(--color-warning)]'
                : 'text-[var(--color-fg)]',
            )}
            title={value}
          >
            {value}
          </span>
        )}
      </div>
      {copy && value && <CopyButton value={value} />}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        toast.success('Copiado');
      }}
      className="shrink-0 text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)]"
      title="Copiar"
    >
      <Copy className="size-3.5" />
    </button>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-3 text-[11px] text-[var(--color-fg-subtle)]">
      {children}
    </div>
  );
}

/* ────────────────────────── helpers ────────────────────────── */

function fecha(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

/** `payload` arranca como `{}` por default, así que "vacío" no es sólo null. */
function esVacio(p: unknown): boolean {
  if (p === null || p === undefined) return true;
  if (typeof p === 'object') return Object.keys(p).length === 0;
  return false;
}
