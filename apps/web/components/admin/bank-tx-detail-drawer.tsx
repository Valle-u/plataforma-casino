/**
 * BankTxDetailDrawer — detalle completo de una transferencia bancaria.
 *
 * Recreado del handoff `handoff_lote_2/Drawers detalle.dc.html`:
 *   - Encabezado con ícono por dirección + "Transferencia de {titular}" +
 *     chips (dirección, estado de conciliación, banco).
 *   - Tarjeta de monto ("Entró/Salió del banco" + fecha recibida).
 *   - Secciones en tarjetas: Conciliación, Banco, Quién la cargó.
 *
 * Read-only: conciliar / editar / borrar viven en la lista de Transferencias.
 */
'use client';

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { Spinner } from '@/components/ui/spinner';
import { formatArDateTime } from '@/lib/format-date';
import {
  useBankTransactionDetail,
  type BankTxMatchDetail,
} from '@/lib/hooks/use-bank-transactions';
import { cn } from '@/lib/cn';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] last:border-b-0">
      <span className="w-[150px] shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <div className="flex-1 min-w-0 font-mono text-[12.5px] text-[var(--color-fg)] break-words">
        {value ?? <span className="text-[var(--color-fg-subtle)]">—</span>}
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-semibold">
        {label}
      </span>
      <span className="flex-1 h-px bg-[var(--color-border)]" />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader label={title} />
      <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden flex flex-col">
        {children}
      </div>
    </section>
  );
}

const MATCH_KIND_LABEL: Record<string, string> = {
  manual_load: 'Carga manual de fichas',
  manual_unload: 'Retiro manual de fichas',
  deposit: 'Depósito',
  withdrawal: 'Retiro',
  capital_injection: 'Inyección de capital',
};

function matchKindKey(m: NonNullable<BankTxMatchDetail>): string {
  if (m.kind === 'manual') {
    return m.movementType === 'unload' ? 'manual_unload' : 'manual_load';
  }
  return m.kind;
}

function MatchDetailBlock({ m }: { m: BankTxMatchDetail }) {
  if (m === null) {
    return (
      <Section title="Conciliación">
        <div className="px-4 py-3 text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
          Sin conciliar todavía. Vinculala con la carga o el retiro que le
          corresponde desde la lista de Transferencias.
        </div>
      </Section>
    );
  }

  const label = MATCH_KIND_LABEL[matchKindKey(m)] ?? 'Movimiento';

  if (m.kind === 'capital_injection') {
    return (
      <Section title="Conciliación">
        <Row label="Tipo" value={label} />
        <Row label="ID" value={<span className="text-[11px]">{m.id}</span>} />
      </Section>
    );
  }

  const amount = m.kind === 'manual' ? m.amount : m.amountChips;
  const player =
    m.playerName || m.playerUsername ? (
      <>
        {m.playerName ?? '—'}
        {m.playerUsername && (
          <span className="text-[var(--color-fg-muted)]"> · @{m.playerUsername}</span>
        )}
      </>
    ) : null;

  return (
    <Section title="Conciliación">
      <Row label="Tipo" value={label} />
      <Row
        label="Monto"
        value={<span className="tabular-nums">{amount} fichas</span>}
      />
      <Row label="Jugador" value={player} />
      {m.kind === 'manual' ? (
        <Row label="Motivo" value={m.reason} />
      ) : (
        <Row label="Estado" value={m.status} />
      )}
      <Row
        label="Fecha del movimiento"
        value={formatArDateTime(m.createdAt, { seconds: true })}
      />
    </Section>
  );
}

/** Chip de estado de conciliación (lenguaje criollo del handoff). */
function statusChip(status: string): { label: string; variant: BadgeVariant } {
  if (status === 'matched') return { label: 'Conciliada', variant: 'success' };
  if (status === 'disputed') return { label: 'En disputa', variant: 'warning' };
  return { label: 'Sin conciliar', variant: 'warning' };
}

export function BankTxDetailDrawer({
  txId,
  onClose,
}: {
  txId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useBankTransactionDetail(txId);

  const incoming = data?.direction !== 'outgoing';
  const dirLabel = data
    ? data.direction === 'outgoing'
      ? 'Saliente'
      : 'Entrante'
    : '';

  return (
    <Drawer
      open={txId !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={
        data
          ? `Transferencia de ${data.senderName || (incoming ? 'origen' : 'destino')}`
          : 'Detalle de la transferencia'
      }
      header={
        data ? (
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'size-10 shrink-0 rounded-[var(--radius-sm)] flex items-center justify-center',
                incoming
                  ? 'bg-[var(--color-info-bg)] text-[var(--color-info)]'
                  : 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
              )}
            >
              {incoming ? (
                <ArrowDownLeft className="size-5" />
              ) : (
                <ArrowUpRight className="size-5" />
              )}
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="font-display text-lg leading-tight tracking-tight truncate">
                Transferencia de{' '}
                {data.senderName || (incoming ? 'origen' : 'destino')}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={incoming ? 'success' : 'warning'}>
                  {incoming ? (
                    <ArrowDownLeft className="size-3" />
                  ) : (
                    <ArrowUpRight className="size-3" />
                  )}
                  {dirLabel}
                </Badge>
                <Badge variant={statusChip(data.status).variant}>
                  {statusChip(data.status).label}
                </Badge>
                {data.bankName && <Badge variant="neutral">{data.bankName}</Badge>}
              </div>
            </div>
          </div>
        ) : undefined
      }
    >
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      {isError && (
        <div className="py-8 text-[13px] text-[var(--color-danger)]">
          No se pudo cargar el detalle.
        </div>
      )}
      {data && (
        <div className="flex flex-col gap-4">
          {/* Monto */}
          <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 flex items-end justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold">
                {incoming ? 'Entró al banco' : 'Salió del banco'}
              </span>
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'font-display text-4xl leading-none tabular-nums tracking-tight',
                    incoming
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-fg)]',
                  )}
                >
                  {incoming ? '+' : '−'}
                  {data.amount}
                </span>
                <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                  {data.currency}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold">
                Recibida
              </span>
              <span className="font-mono text-sm text-[var(--color-fg-muted)]">
                {formatArDateTime(data.receivedAt, { seconds: true })}
              </span>
            </div>
          </div>

          <MatchDetailBlock m={data.matchDetail} />

          <Section title="Banco">
            <Row label="Banco (cuenta propia)" value={data.bankName} />
            <Row label="Titular de la cuenta" value={data.accountHolder} />
            <Row
              label={
                data.direction === 'outgoing'
                  ? 'Titular que recibe'
                  : 'Titular que envía'
              }
              value={data.senderName}
            />
            <Row label="CBU/CVU de origen" value={data.senderCbu} />
            <Row label="Referencia" value={data.reference} />
            <Row label="Cuenta" value={data.bankAccount} />
            {data.receiptUrl && (
              <Row
                label="Comprobante"
                value={
                  <a
                    href={data.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-info)] underline underline-offset-2 hover:brightness-110"
                  >
                    Ver comprobante
                  </a>
                }
              />
            )}
          </Section>

          {data.status === 'matched' && (
            <Section title="Quién concilió">
              <Row
                label="Conciliada por"
                value={data.matchedByUsername ? `@${data.matchedByUsername}` : null}
              />
              <Row
                label="Fecha de conciliación"
                value={
                  data.matchedAt
                    ? formatArDateTime(data.matchedAt, { seconds: true })
                    : null
                }
              />
              <Row label="Motivo del override" value={data.overrideReason} />
            </Section>
          )}

          <Section title="Quién la cargó">
            <Row
              label="Subida por"
              value={data.uploaderUsername ? `@${data.uploaderUsername}` : null}
            />
            <Row
              label="Fecha de carga"
              value={formatArDateTime(data.uploadedAt, { seconds: true })}
            />
            {data.notes && <Row label="Notas" value={data.notes} />}
          </Section>
        </div>
      )}
    </Drawer>
  );
}
