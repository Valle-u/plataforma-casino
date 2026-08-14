/**
 * BankTxDetailDrawer — detalle completo de una transferencia bancaria.
 *
 * Se abre al tocar una transferencia en la sección Transferencias. Muestra:
 *   - Todos los datos bancarios (banco, titular, remitente, CBU, referencia,
 *     comprobante, fecha).
 *   - CON QUÉ está conciliada: carga/retiro manual, depósito o retiro,
 *     resuelto a datos legibles (monto, jugador, fecha, motivo).
 *   - Quién la concilió y cuándo, y el motivo del override si hubo.
 *   - Trazabilidad de la subida.
 */
'use client';

import { Badge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { Spinner } from '@/components/ui/spinner';
import { formatArDateTime } from '@/lib/format-date';
import {
  useBankTransactionDetail,
  type BankTxMatchDetail,
} from '@/lib/hooks/use-bank-transactions';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-[12px]">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-[var(--color-fg)] text-right min-w-0 break-words">
        {value ?? <span className="text-[var(--color-fg-subtle)]">—</span>}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-accent-text)] font-medium mb-1">
        {title}
      </h3>
      <div className="divide-y divide-[var(--color-border)]">{children}</div>
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
        <div className="py-2 text-[12px] text-[var(--color-fg-muted)]">
          Sin conciliar todavía. Usá <strong>Conciliar</strong> para vincularla
          con una carga/retiro manual.
        </div>
      </Section>
    );
  }

  const label = MATCH_KIND_LABEL[matchKindKey(m)] ?? 'Movimiento';

  if (m.kind === 'capital_injection') {
    return (
      <Section title="Conciliación">
        <Row label="Tipo" value={label} />
        <Row label="ID" value={<span className="font-mono text-[11px]">{m.id}</span>} />
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
        value={<span className="font-mono tabular-nums">{amount} fichas</span>}
      />
      <Row label="Jugador" value={player} />
      {m.kind === 'manual' ? (
        <Row label="Motivo" value={m.reason} />
      ) : (
        <Row label="Estado" value={m.status} />
      )}
      <Row label="Fecha del movimiento" value={formatArDateTime(m.createdAt, { seconds: true })} />
    </Section>
  );
}

export function BankTxDetailDrawer({
  txId,
  onClose,
}: {
  txId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useBankTransactionDetail(txId);

  const dirLabel =
    data?.direction === 'outgoing' ? 'Saliente' : data ? 'Entrante' : '';

  return (
    <Drawer
      open={txId !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Detalle de la transferencia"
      subtitle={
        data
          ? `${data.direction === 'outgoing' ? '−' : '+'}${data.amount} ${data.currency} · ${dirLabel}`
          : undefined
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
        <div className="flex flex-col gap-5 p-1">
          <Section title="Datos">
            <Row
              label="Monto"
              value={
                <span className="font-mono tabular-nums">
                  {data.direction === 'outgoing' ? '−' : '+'}
                  {data.amount} {data.currency}
                </span>
              }
            />
            <Row label="Dirección" value={dirLabel} />
            <Row
              label="Estado"
              value={
                <Badge
                  variant={
                    data.status === 'matched'
                      ? 'success'
                      : data.status === 'disputed'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {data.status === 'matched'
                    ? 'Matcheada'
                    : data.status === 'disputed'
                      ? 'En disputa'
                      : 'Sin matchear'}
                </Badge>
              }
            />
            <Row
              label="Fecha recibida"
              value={formatArDateTime(data.receivedAt, { seconds: true })}
            />
          </Section>

          <Section title="Banco">
            <Row label="Banco (cuenta propia)" value={data.bankName} />
            <Row label="Titular cuenta propia" value={data.accountHolder} />
            <Row
              label={data.direction === 'outgoing' ? 'Titular que recibe' : 'Titular que envía'}
              value={data.senderName}
            />
            <Row label="CBU/CVU origen" value={data.senderCbu} />
            <Row label="Referencia" value={data.reference} />
            <Row
              label="Cuenta"
              value={data.bankAccount ? <span className="font-mono">{data.bankAccount}</span> : null}
            />
            {data.receiptUrl && (
              <Row
                label="Comprobante"
                value={
                  <a
                    href={data.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-accent-text)] underline underline-offset-2"
                  >
                    Ver comprobante
                  </a>
                }
              />
            )}
          </Section>

          <MatchDetailBlock m={data.matchDetail} />

          {data.status === 'matched' && (
            <Section title="Quién concilió">
              <Row
                label="Conciliada por"
                value={data.matchedByUsername ? `@${data.matchedByUsername}` : null}
              />
              <Row
                label="Fecha de conciliación"
                value={data.matchedAt ? formatArDateTime(data.matchedAt, { seconds: true }) : null}
              />
              <Row label="Motivo del override" value={data.overrideReason} />
            </Section>
          )}

          <Section title="Trazabilidad">
            <Row
              label="Subida por"
              value={data.uploaderUsername ? `@${data.uploaderUsername}` : null}
            />
            <Row label="Fecha de subida" value={formatArDateTime(data.uploadedAt, { seconds: true })} />
            {data.notes && <Row label="Notas" value={data.notes} />}
          </Section>
        </div>
      )}
    </Drawer>
  );
}
