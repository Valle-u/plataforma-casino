/**
 * /admin/bank-transactions — Sprint 50.
 *
 * El empleado de confianza carga las transferencias entrantes que ve en
 * el extracto bancario del tenant. Después el cajero (en /deposits)
 * matchea esas tx con los deposits pendientes antes de aprobar.
 *
 * Tabs:
 *   - Unmatched: pending para matchear (default).
 *   - Matched: ya asociadas a un deposit aprobado.
 *   - Disputed: marcadas por admin (rare).
 *
 * El form de upload está siempre visible arriba — el empleado sube
 * transferencias rápido sin perder contexto.
 */

'use client';

import { Building2, ChevronDown, Landmark, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/api-client';
import {
  BANK_TX_STATUS_LABELS,
  useBankTransactions,
  useUploadBankTransaction,
  type BankTxStatus,
} from '@/lib/hooks/use-bank-transactions';

type Tab = BankTxStatus;

const TABS: { id: Tab; label: string }[] = [
  { id: 'unmatched', label: 'Sin matchear' },
  { id: 'matched', label: 'Matcheadas' },
  { id: 'disputed', label: 'En disputa' },
];

export default function BankTransactionsPage() {
  const [tab, setTab] = useState<Tab>('unmatched');
  const [showForm, setShowForm] = useState(true);

  const { data, isLoading, isError, refetch, isFetching } = useBankTransactions({
    status: tab,
    limit: 50,
  });

  const rows = data?.data ?? [];

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Landmark className="size-3" />
            Operación · Transferencias bancarias
          </span>
          <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
            Transferencias bancarias
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">
            El empleado de confianza sube acá las transferencias entrantes que ve
            en el extracto bancario. Los cajeros las matchean con los deposits al
            aprobar.
          </p>
        </div>
      </header>

      {/* Upload form (colapsable) */}
      <UploadForm visible={showForm} onToggle={() => setShowForm((s) => !s)} />

      {/* Tabs */}
      <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors',
              tab === t.id
                ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
        <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
            {isLoading ? 'Cargando…' : `${rows.length} transferencias`}
          </span>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} />
            Refrescar
          </Button>
        </div>
        {isLoading ? (
          <div className="p-4 flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState hint="bank-tx" label="Error al cargar." />
        ) : rows.length === 0 ? (
          <EmptyState
            hint="bank-tx"
            label={
              tab === 'unmatched'
                ? 'Sin transferencias pendientes — todas matcheadas.'
                : 'Sin transferencias en este filtro.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Cuenta</TH>
                <TH className="text-right">Monto</TH>
                <TH>Remitente</TH>
                <TH>Referencia</TH>
                <TH>Subida por</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="num text-[11px] text-[var(--color-fg-muted)]">
                    {new Date(r.receivedAt).toLocaleString('es-AR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TD>
                  <TD className="text-[11px] font-mono text-[var(--color-fg-muted)]">
                    {r.bankAccount}
                  </TD>
                  <TD className="text-right num font-mono">
                    {r.amount} <span className="text-[10px] text-[var(--color-fg-subtle)]">{r.currency}</span>
                  </TD>
                  <TD className="text-[12px]">{r.senderName ?? '—'}</TD>
                  <TD className="text-[11px] text-[var(--color-fg-muted)] truncate max-w-[180px]" title={r.reference ?? undefined}>
                    {r.reference ?? r.bankReference ?? '—'}
                  </TD>
                  <TD className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
                    @{r.uploaderUsername ?? '?'}
                  </TD>
                  <TD>
                    <Badge variant={r.status === 'matched' ? 'success' : r.status === 'disputed' ? 'warning' : 'neutral'}>
                      {BANK_TX_STATUS_LABELS[r.status]}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Upload form
// ──────────────────────────────────────────────────────────────────────

function UploadForm({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const upload = useUploadBankTransaction();
  const [form, setForm] = useState({
    bankAccount: '',
    amount: '',
    currency: 'ARS',
    senderName: '',
    senderCbu: '',
    reference: '',
    bankReference: '',
    receivedAt: nowLocalIso(),
    notes: '',
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.bankAccount || !form.amount || !form.receivedAt) {
      toast.error('Cuenta, monto y fecha son obligatorios');
      return;
    }
    try {
      await upload.mutateAsync({
        bankAccount: form.bankAccount,
        amount: form.amount,
        currency: form.currency || 'ARS',
        senderName: form.senderName || undefined,
        senderCbu: form.senderCbu || undefined,
        reference: form.reference || undefined,
        bankReference: form.bankReference || undefined,
        receivedAt: new Date(form.receivedAt).toISOString(),
        notes: form.notes || undefined,
      });
      toast.success('Transferencia cargada');
      setForm({
        bankAccount: form.bankAccount, // mantener cuenta + currency
        amount: '',
        currency: form.currency,
        senderName: '',
        senderCbu: '',
        reference: '',
        bankReference: '',
        receivedAt: nowLocalIso(),
        notes: '',
      });
    } catch (err) {
      toast.error('No se pudo cargar', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  }

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between hover:bg-[var(--color-bg-subtle)]"
      >
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg)] font-medium flex items-center gap-2">
          <Building2 className="size-3.5 text-[var(--color-accent-text)]" />
          Cargar nueva transferencia
        </span>
        <ChevronDown
          className={cn('size-3.5 transition-transform', !visible && '-rotate-90')}
        />
      </button>
      {visible && (
        <form onSubmit={submit} className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Cuenta bancaria *" required>
            <Input value={form.bankAccount} onChange={(e) => update('bankAccount', e.target.value)} placeholder="CBU/alias" />
          </Field>
          <Field label="Monto *" required>
            <Input value={form.amount} onChange={(e) => update('amount', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" className="font-mono" />
          </Field>
          <Field label="Moneda">
            <Input value={form.currency} onChange={(e) => update('currency', e.target.value.toUpperCase())} placeholder="ARS" maxLength={5} />
          </Field>
          <Field label="Recibida en *" required>
            <Input type="datetime-local" value={form.receivedAt} onChange={(e) => update('receivedAt', e.target.value)} />
          </Field>
          <Field label="Remitente (nombre)">
            <Input value={form.senderName} onChange={(e) => update('senderName', e.target.value)} placeholder="Juan Pérez" />
          </Field>
          <Field label="Remitente (CBU/alias)">
            <Input value={form.senderCbu} onChange={(e) => update('senderCbu', e.target.value)} placeholder="opcional" className="font-mono" />
          </Field>
          <Field label="Referencia / concepto">
            <Input value={form.reference} onChange={(e) => update('reference', e.target.value)} placeholder="lo que dice el extracto" />
          </Field>
          <Field label="Nro. operación del banco">
            <Input value={form.bankReference} onChange={(e) => update('bankReference', e.target.value)} placeholder="ej. 12345" className="font-mono" />
          </Field>
          <Field label="Notas">
            <Input value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="opcional" />
          </Field>
          <div className="md:col-span-3 flex justify-end">
            <Button type="submit" variant="primary" size="md" disabled={upload.isPending}>
              {upload.isPending ? (
                <>
                  <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Cargando…
                </>
              ) : (
                <>
                  <Plus className="size-3.5" />
                  Cargar transferencia
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>
        {label}
        {required && <span className="text-[var(--color-accent-text)]"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function nowLocalIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
