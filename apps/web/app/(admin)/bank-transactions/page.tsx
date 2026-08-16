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

import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  FileText,
  Landmark,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { BankTxCardList } from '@/components/admin/bank-tx-card-list';
import { EditBankTxModal } from '@/components/admin/edit-bank-tx-modal';
import { MatchManualTxModal } from '@/components/admin/match-manual-tx-modal';
import { BankTxDetailDrawer } from '@/components/admin/bank-tx-detail-drawer';
import {
  deleteSavedAccount,
  loadLastAccountId,
  loadLastCounterparty,
  loadSavedAccounts,
  saveLastAccountId,
  saveLastCounterparty,
  upsertSavedAccount,
  type SavedBankAccount,
} from '@/lib/bank-accounts-storage';
import { cn } from '@/lib/cn';
import {
  arDatetimeLocalToIso,
  arTodayDateStr,
  formatArDateTime,
  isoToArDatetimeLocal,
} from '@/lib/format-date';
import { isApiError } from '@/lib/api-client';
import { hasPermission, useAuth } from '@/lib/auth-context';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import {
  BANK_TX_STATUS_LABELS,
  useBankAccountBalances,
  useBankTransactions,
  useDeleteBankTransaction,
  useUploadBankTransaction,
  useUploadBankTxProof,
  type BankAccountBalance,
  type BankTransaction,
  type BankTxDirection,
  type BankTxStatus,
} from '@/lib/hooks/use-bank-transactions';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// 'todos' es un filtro solo de UI — nunca llega como status/direction real de
// una fila (BankTxStatus/BankTxDirection quedan intactos para eso).
type Tab = BankTxStatus | 'todos';
type DirectionTab = BankTxDirection | 'todos';

const TABS: { id: Tab; label: string }[] = [
  { id: 'todos', label: 'Todas' },
  { id: 'unmatched', label: 'Sin matchear' },
  { id: 'matched', label: 'Matcheadas' },
  { id: 'disputed', label: 'En disputa' },
];

const DIRECTION_TABS: { id: DirectionTab; label: string; hint: string }[] = [
  { id: 'todos', label: 'Todas', hint: 'Entrantes y salientes juntas' },
  { id: 'incoming', label: 'Entrantes', hint: 'Transferencias que recibimos (para deposits)' },
  { id: 'outgoing', label: 'Salientes', hint: 'Transferencias que enviamos (para withdrawals)' },
];

export default function BankTransactionsPage() {
  const { user: actor } = useAuth();
  const [direction, setDirection] = useState<DirectionTab>('incoming');
  const [tab, setTab] = useState<Tab>('unmatched');
  const [showForm, setShowForm] = useState(true);
  const [editTarget, setEditTarget] = useState<BankTransaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BankTransaction | null>(null);
  const [matchTarget, setMatchTarget] = useState<BankTransaction | null>(null);
  const [detailTxId, setDetailTxId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  // Editar/borrar solo se ofrecen a quien tenga el permiso (el backend igual
  // revalida) y solo para transferencias que todavía no se matchearon.
  const canUpload = hasPermission(actor, 'bank_tx.upload');
  const canEdit = hasPermission(actor, 'bank_tx.edit');
  const canDelete = hasPermission(actor, 'bank_tx.delete');
  const canMatch = hasPermission(actor, 'bank_tx.match');
  const showActions = canEdit || canDelete || canMatch;

  const deleteMutation = useDeleteBankTransaction();

  // Fase B: polling en la tab 'unmatched' — es la cola de trabajo: el
  // cajero está esperando que entren transferencias para matchear.
  const pollingInterval = tab === 'unmatched' ? 10_000 : false;

  const { data, isLoading, isError, refetch, isFetching } = useBankTransactions(
    {
      status: tab === 'todos' ? undefined : tab,
      direction: direction === 'todos' ? undefined : direction,
      search: debouncedSearch,
      limit: 50,
    },
    { refetchInterval: pollingInterval },
  );

  const rows = data?.data ?? [];
  // Con dirección "Todas" mezclamos entrantes/salientes en la misma tabla —
  // mostramos una columna extra para distinguirlas de un vistazo.
  const showDirectionColumn = direction === 'todos';

  // Mismos filtros que el listado — el CSV exportado respeta lo que ves en
  // pantalla (search/status/direction), pero sin el limit de 50 (server cap).
  const exportParams = {
    status: tab === 'todos' ? undefined : tab,
    direction: direction === 'todos' ? undefined : direction,
    search: debouncedSearch || undefined,
  };

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success('Transferencia borrada');
      setDeleteTarget(null);
    } catch (err) {
      toast.error('No se pudo borrar', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  }

  return (
    <PageShell className="max-w-[1400px] scroll-safe-bottom">
      <PageHeader
        icon={Landmark}
        title="Transferencias bancarias"
        description="Acá se cargan las transferencias que entran y salen del banco, para después matchearlas con las cargas y los retiros."
        actions={
          <CsvExportButton
            path="/tenant/bank-transactions/export"
            params={exportParams}
            filenameHint="bank-transactions"
            permission="bank_tx.export"
            entityLabel="transferencias"
          />
        }
      />

      <HelpNote id="bank-transactions">
        Cuando entra o sale plata del banco del casino, alguien de confianza la
        <strong> carga acá</strong> (con fecha, monto y titular). Después esa
        transferencia se <strong>matchea</strong>: las <strong>entrantes</strong>{' '}
        se vinculan con las cargas de los jugadores (en Depósitos), y las{' '}
        <strong>salientes</strong> con los retiros que pagás. Así queda todo
        cruzado y sabés que la plata del sistema coincide con la del banco de
        verdad. Las que todavía no cruzaste aparecen en <strong>Sin matchear</strong>.
      </HelpNote>

      {/* Upload form (colapsable) — solo se muestra si el actor puede subir
          transferencias. Un empleado de Soporte, por ejemplo, ve el listado
          pero no el form. Recibe la dirección seleccionada para pre-marcarla. */}
      {canUpload && (
        <UploadForm
          visible={showForm}
          onToggle={() => setShowForm((s) => !s)}
          defaultDirection={direction === 'todos' ? 'incoming' : direction}
        />
      )}

      {/* Buscador por contraparte — filtra el listado por senderName (ILIKE). */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
        <Input
          placeholder="Buscar por nombre de la contraparte…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-11 lg:h-9"
        />
      </div>

      {/* Direction tabs (Sprint 51) — entrante vs saliente. */}
      <div className="flex flex-col gap-2 max-w-full sm:self-start">
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] overflow-x-auto hide-scrollbar max-w-full">
          {DIRECTION_TABS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDirection(d.id)}
              title={d.hint}
              className={cn(
                'shrink-0 whitespace-nowrap px-4 h-10 lg:h-8 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors active:scale-[0.98]',
                direction === d.id
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-[var(--color-fg-subtle)]">
          {DIRECTION_TABS.find((d) => d.id === direction)?.hint}
        </span>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] overflow-x-auto hide-scrollbar max-w-full sm:self-start">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'shrink-0 whitespace-nowrap px-4 h-10 lg:h-8 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors active:scale-[0.98]',
              tab === t.id
                ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Listado: header compartido (conteo + refresh) */}
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

        {/* Sprint 56: card list mobile (< lg). La tabla desktop queda en lg+. */}
        <div className="flex flex-col gap-3 p-3 lg:hidden">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full bg-[var(--color-bg-subtle)]" />
            ))
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
            <BankTxCardList
              rows={rows}
              canEdit={canEdit}
              canDelete={canDelete}
              canMatch={canMatch}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
              onMatchManual={setMatchTarget}
              onOpenDetail={setDetailTxId}
            />
          )}
        </div>

        {/* Tabla (desktop) */}
        <div className="hidden lg:block overflow-x-auto">
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
                {showDirectionColumn && <TH>Dir.</TH>}
                <TH>Banco · Titular</TH>
                <TH className="text-right">Monto</TH>
                <TH>Contraparte</TH>
                <TH>Subida por</TH>
                <TH>Estado</TH>
                {showActions && <TH className="text-right">Acciones</TH>}
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR
                  key={r.id}
                  interactive
                  onClick={() => setDetailTxId(r.id)}
                >
                  <TD className="num text-[11px] text-[var(--color-fg-muted)]">
                    {formatArDateTime(r.receivedAt)}
                  </TD>
                  {showDirectionColumn && (
                    <TD>
                      <Badge variant={r.direction === 'outgoing' ? 'warning' : 'success'}>
                        {r.direction === 'outgoing' ? (
                          <ArrowUpRight className="size-3" />
                        ) : (
                          <ArrowDownLeft className="size-3" />
                        )}
                        {r.direction === 'outgoing' ? 'Saliente' : 'Entrante'}
                      </Badge>
                    </TD>
                  )}
                  <TD className="text-[11px] text-[var(--color-fg-muted)]">
                    {r.bankName ? (
                      <>
                        {r.bankName}
                        {r.accountHolder && (
                          <span className="text-[var(--color-fg-subtle)]">
                            {' '}
                            · {r.accountHolder}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="font-mono">{r.bankAccount ?? '—'}</span>
                    )}
                  </TD>
                  <TD className="text-right num font-mono">
                    {r.direction === 'outgoing' ? '−' : '+'}
                    {r.amount}{' '}
                    <span className="text-[10px] text-[var(--color-fg-subtle)]">{r.currency}</span>
                  </TD>
                  <TD className="text-[12px]">
                    {r.senderName ?? '—'}
                  </TD>
                  <TD className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
                    @{r.uploaderUsername ?? '?'}
                  </TD>
                  <TD>
                    <Badge variant={r.status === 'matched' ? 'success' : r.status === 'disputed' ? 'warning' : 'neutral'}>
                      {BANK_TX_STATUS_LABELS[r.status]}
                    </Badge>
                  </TD>
                  {showActions && (
                    <TD className="text-right">
                      {r.status !== 'matched' ? (
                        <div className="flex items-center justify-end gap-px bg-[var(--color-border)] w-fit ml-auto">
                          {canMatch && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMatchTarget(r);
                              }}
                              className="size-10 flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                              aria-label="Conciliar con carga/retiro manual"
                              title="Conciliar con carga/retiro manual"
                            >
                              <Link2 className="size-[18px]" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditTarget(r);
                              }}
                              className="size-10 flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                              aria-label="Editar transferencia"
                              title="Editar"
                            >
                              <Pencil className="size-[18px]" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(r);
                              }}
                              className="size-10 flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)] transition-colors"
                              aria-label="Borrar transferencia"
                              title="Borrar"
                            >
                              <Trash2 className="size-[18px]" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-[var(--color-fg-subtle)]">—</span>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        </div>
      </div>

      {/* Balances bancarios — entrantes − salientes de TODO lo cargado
          (matched + unmatched, decisión dueño 2026-08-14) agrupado por
          cuenta propia (banco + titular). */}
      <BankBalancesSection />

      {/* Detalle de la transferencia (con qué está conciliada + info) */}
      <BankTxDetailDrawer txId={detailTxId} onClose={() => setDetailTxId(null)} />

      {/* Conciliar con carga/retiro manual (solo sin conciliar) */}
      {matchTarget && (
        <MatchManualTxModal
          bankTx={matchTarget}
          open={!!matchTarget}
          onOpenChange={(o) => !o && setMatchTarget(null)}
        />
      )}

      {/* Editar transferencia (solo sin matchear) */}
      <EditBankTxModal
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        transaction={editTarget}
      />

      {/* Confirmar borrado */}
      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Borrar transferencia"
        description={
          deleteTarget
            ? `Vas a borrar la transferencia ${deleteTarget.direction === 'outgoing' ? 'saliente' : 'entrante'} de ${deleteTarget.amount} ${deleteTarget.currency}${deleteTarget.bankName ? ` del banco ${deleteTarget.bankName}` : ''}.`
            : ''
        }
        warning="Esta acción no se puede deshacer. Solo se pueden borrar transferencias que todavía no fueron matcheadas."
        confirmLabel="Borrar"
        confirmIcon={<Trash2 className="size-3.5" />}
        confirmVariant="danger"
        onConfirm={confirmDelete}
        isPending={deleteMutation.isPending}
      />
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Upload form
// ──────────────────────────────────────────────────────────────────────

/**
 * Sprint 54 (decisión dueño): form ultra-simplificado.
 *
 *   Entrante:  Fecha · Hora del comprobante · Titular que envía · Monto
 *              + cuenta propia (titular + banco) con la que se recibe.
 *   Saliente:  Fecha · Hora · Monto · Titular que recibe · comprobante
 *              + cuenta propia (titular + banco) con la que se envía.
 *
 * La cuenta propia se elige de las guardadas en localStorage (por
 * dispositivo) o se carga como nueva y queda guardada ("casilla que
 * guarda el dato"). Fecha/Hora vienen con hoy/hora actual.
 * Fuera del form por decisión del dueño: CBU, moneda (fija ARS),
 * referencia, notas y CBU del remitente.
 */
function UploadForm({
  visible,
  onToggle,
  defaultDirection,
}: {
  visible: boolean;
  onToggle: () => void;
  defaultDirection: BankTxDirection;
}) {
  const upload = useUploadBankTransaction();
  const uploadProof = useUploadBankTxProof();
  const [form, setForm] = useState({
    direction: defaultDirection,
    accountId: '', // '' = "Nueva cuenta…"
    newAccountHolder: '',
    newBankName: '',
    date: todayLocalDate(),
    time: nowLocalTime(),
    senderName: '',
    amount: '',
  });
  const [accounts, setAccounts] = useState<SavedBankAccount[]>([]);

  // Sprint 52: comprobante obligatorio para transferencias salientes
  // (two-step: /upload-proof → mandamos receiptUrl + receiptStorageKey).
  const [proof, setProof] = useState<{
    file: File;
    previewUrl: string;
    receiptUrl: string;
    receiptStorageKey: string;
    receiptHash: string;
  } | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Sprint 56: autofocus al monto tras cargar → "carga en cadena" sin re-tocar el form.
  const amountRef = useRef<HTMLInputElement>(null);

  // Cargar las cuentas guardadas del dispositivo y preseleccionar la
  // última usada (auto: "último valor usado"). Sprint 56: también se
  // autocompleta el último titular que envió/recibió (contraparte).
  useEffect(() => {
    const saved = loadSavedAccounts();
    setAccounts(saved);
    const lastId = loadLastAccountId();
    const lastExists = lastId !== null && saved.some((a) => a.id === lastId);
    const lastCounterparty = loadLastCounterparty();
    setForm((f) => ({
      ...f,
      accountId: lastExists && lastId ? lastId : (saved[0]?.id ?? ''),
      senderName: lastCounterparty ?? '',
    }));
  }, []);

  // Sincronizar el form con la dirección del tab activo cuando cambia.
  // El empleado puede pisarla a mano dentro del form si quiere.
  useEffect(() => {
    setForm((f) => ({ ...f, direction: defaultDirection }));
  }, [defaultDirection]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function removeAccount(id: string) {
    deleteSavedAccount(id);
    setAccounts(loadSavedAccounts());
    setForm((f) => ({ ...f, accountId: '' }));
  }

  const handleFile = async (file: File): Promise<void> => {
    setProofError(null);
    if (!ALLOWED_MIME.has(file.type)) {
      setProofError(`Tipo no permitido (${file.type}). Usá JPG, PNG, WEBP o PDF.`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setProofError(
        `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)}MB — el máx es 5MB.`,
      );
      return;
    }
    if (proof?.previewUrl) URL.revokeObjectURL(proof.previewUrl);
    try {
      const res = await uploadProof.mutateAsync(file);
      const previewUrl = URL.createObjectURL(file);
      setProof({
        file,
        previewUrl,
        receiptUrl: res.receiptUrl,
        receiptStorageKey: res.receiptStorageKey,
        receiptHash: res.receiptHash,
      });
    } catch (err) {
      setProofError(
        isApiError(err) ? err.message : 'Error de conexión al subir el comprobante.',
      );
    }
  };

  const clearProof = (): void => {
    if (proof?.previewUrl) URL.revokeObjectURL(proof.previewUrl);
    setProof(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.date || !form.time) {
      toast.error('Fecha y hora son obligatorias');
      return;
    }
    if (!form.amount) {
      toast.error('El monto es obligatorio');
      return;
    }
    if (!form.senderName.trim()) {
      toast.error(
        form.direction === 'outgoing'
          ? 'El titular que recibe es obligatorio'
          : 'El titular que envía es obligatorio',
      );
      return;
    }
    if (form.direction === 'outgoing' && !proof) {
      toast.error('El comprobante es obligatorio para transferencias salientes');
      return;
    }
    // Resolver la cuenta propia: seleccionada o nueva (queda guardada).
    let account: SavedBankAccount;
    if (form.accountId) {
      const selected = accounts.find((a) => a.id === form.accountId);
      if (!selected) {
        toast.error('Cuenta seleccionada inválida');
        return;
      }
      account = selected;
    } else {
      if (!form.newBankName.trim() || !form.newAccountHolder.trim()) {
        toast.error('Completá el titular y el banco de la nueva cuenta');
        return;
      }
      account = upsertSavedAccount(form.newBankName, form.newAccountHolder);
      setAccounts(loadSavedAccounts());
    }
    try {
      await upload.mutateAsync({
        amount: form.amount,
        currency: 'ARS',
        direction: form.direction,
        accountHolder: account.accountHolder,
        bankName: account.bankName,
        senderName: form.senderName.trim(),
        receiptUrl: form.direction === 'outgoing' ? proof?.receiptUrl : undefined,
        receiptStorageKey:
          form.direction === 'outgoing' ? proof?.receiptStorageKey : undefined,
        receiptHash: form.direction === 'outgoing' ? proof?.receiptHash : undefined,
        receivedAt: combineDateTime(form.date, form.time),
      });
      saveLastAccountId(account.id);
      // Sprint 56: el último titular que envió/recibió queda autocompletado
      // para la siguiente carga (carga en cadena del mismo cliente).
      const senderName = form.senderName.trim();
      saveLastCounterparty(senderName);
      toast.success(
        form.direction === 'outgoing'
          ? 'Transferencia saliente cargada'
          : 'Transferencia entrante cargada',
      );
      clearProof();
      setForm((f) => ({
        ...f,
        amount: '',
        senderName,
        date: todayLocalDate(),
        time: nowLocalTime(),
      }));
      amountRef.current?.focus();
    } catch (err) {
      toast.error('No se pudo cargar', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  }

  const isNewAccount = form.accountId === '';
  const counterpartyLabel =
    form.direction === 'outgoing' ? 'Titular que recibe' : 'Titular que envía';

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
          <Field label="Dirección" required>
            {/* Sprint 56: en mobile el segmented es full-width con touch
                target alto; en desktop vuelve al formato compacto. */}
            <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] w-full md:w-fit">
              {(
                [
                  { id: 'incoming' as const, label: 'Entrante' },
                  { id: 'outgoing' as const, label: 'Saliente' },
                ]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, direction: opt.id }))}
                  className={cn(
                    'flex-1 md:flex-none px-4 md:px-3 h-11 md:h-8 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors active:scale-[0.98]',
                    form.direction === opt.id
                      ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)]'
                      : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Cuenta propia (titular · banco)" required>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Select
                  value={form.accountId}
                  onChange={(e) => update('accountId', e.target.value)}
                >
                  <option value="">Nueva cuenta…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.bankName} · {a.accountHolder}
                    </option>
                  ))}
                </Select>
              </div>
              {!isNewAccount && (
                <button
                  type="button"
                  onClick={() => removeAccount(form.accountId)}
                  className="size-9 shrink-0 flex items-center justify-center border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)] transition-colors"
                  aria-label="Borrar esta cuenta guardada"
                  title="Borrar esta cuenta guardada"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          </Field>
          {isNewAccount && (
            <>
              <Field label="Titular de la cuenta" required>
                <Input
                  value={form.newAccountHolder}
                  onChange={(e) => update('newAccountHolder', e.target.value)}
                  placeholder="Juan Pérez"
                />
              </Field>
              <Field label="Banco" required>
                <Input
                  value={form.newBankName}
                  onChange={(e) => update('newBankName', e.target.value)}
                  placeholder="Banco Nación"
                />
              </Field>
            </>
          )}
          {/* Sprint 56: Fecha+Hora. En mobile (<sm) van apiladas full-width:
              los inputs nativos date/time de iOS tienen ancho mínimo intrínseco
              (~200px) y en 2 columnas (157px) desbordan y se superponen entre sí.
              Desde sm van lado a lado; en md+ el wrapper se disuelve (md:contents)
              y quedan como celdas propias de la grilla de 3 columnas. */}
          <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2 md:contents">
            <Field label="Fecha" required>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => update('date', e.target.value)}
              />
            </Field>
            <Field
              label={
                form.direction === 'outgoing'
                  ? 'Hora'
                  : 'Hora del comprobante'
              }
              required
            >
              <Input
                type="time"
                value={form.time}
                onChange={(e) => update('time', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Monto" required>
            <Input
              ref={amountRef}
              value={form.amount}
              onChange={(e) =>
                update('amount', e.target.value.replace(/[^0-9.]/g, ''))
              }
              placeholder="0.00"
              className="font-mono"
              // Sprint 56 (iPhone 13): teclado numérico con coma/punto,
              // sin autocomplete, y "siguiente" en la barra del teclado.
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
            />
          </Field>
          <Field label={`${counterpartyLabel}`} required>
            <Input
              value={form.senderName}
              onChange={(e) => update('senderName', e.target.value)}
              placeholder="Juan Pérez"
              autoCapitalize="words"
              autoComplete="off"
              enterKeyHint="done"
            />
          </Field>
          {form.direction === 'outgoing' && (
            <Field label="Comprobante de la transferencia" required>
              {!proof ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    const file = e.dataTransfer.files[0];
                    if (file) void handleFile(file);
                  }}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 px-4 py-6 border-2 border-dashed transition-colors cursor-pointer',
                    isDragOver
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                      : 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] hover:border-[var(--color-accent)] hover:bg-[var(--color-bg)]',
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFile(file);
                    }}
                  />
                  {uploadProof.isPending ? (
                    <>
                      <span className="size-4 border-2 border-[var(--color-accent)] border-r-transparent animate-spin rounded-full" />
                      <span className="text-[11px] text-[var(--color-fg-muted)]">
                        Subiendo…
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="size-4 text-[var(--color-fg-subtle)]" />
                      <span className="text-[11px] text-[var(--color-fg)]">
                        Arrastrá o hacé clic
                      </span>
                      <span className="text-[10px] text-[var(--color-fg-subtle)]">
                        JPG · PNG · WEBP · PDF (máx 5 MB)
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2 bg-[var(--color-bg)] border border-[var(--color-success)] border-l-2 border-l-[var(--color-success)]">
                  <div className="size-10 shrink-0 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] overflow-hidden flex items-center justify-center">
                    {proof.file.type.startsWith('image/') ? (
                      <img
                        src={proof.previewUrl}
                        alt="preview"
                        className="size-full object-cover"
                      />
                    ) : (
                      <FileText className="size-4 text-[var(--color-fg-subtle)]" />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-[11px] text-[var(--color-fg)] font-medium truncate">
                      {proof.file.name}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-success)]">
                      <Check className="size-3" strokeWidth={3} />
                      Subido correctamente
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={clearProof}
                    className="size-6 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] transition-colors"
                    aria-label="Quitar"
                    title="Quitar y subir otro"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
              {proofError && (
                <span className="text-[11px] text-[var(--color-danger)]">{proofError}</span>
              )}
            </Field>
          )}
          {/* Sprint 56 (decisión dueño): en mobile el botón de cargar queda
              fijo abajo de la pantalla (sticky + safe-area) para estar siempre
              al alcance del pulgar; en desktop vuelve al pie del form. */}
          <div className="md:col-span-3 sticky bottom-0 z-10 -mx-4 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] mt-1 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-[0_-6px_16px_-8px_rgba(0,0,0,0.35)] md:static md:mx-0 md:px-0 md:py-0 md:mt-0 md:border-t-0 md:bg-transparent md:shadow-none md:flex md:justify-end">
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={upload.isPending || uploadProof.isPending}
              className="w-full h-12 text-[15px] md:w-auto md:h-8 md:text-[13px]"
            >
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

// ──────────────────────────────────────────────────────────────────────
// Balances bancarios — entrantes − salientes por cuenta propia
// ──────────────────────────────────────────────────────────────────────

function BankBalancesSection() {
  const { user: actor } = useAuth();
  const canExport = hasPermission(actor, 'bank_tx.export');
  const [visible, setVisible] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useBankAccountBalances({
    enabled: visible,
  });
  const rows = data?.data ?? [];

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-[var(--color-bg-subtle)]"
      >
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg)] font-medium flex items-center gap-2">
          <Landmark className="size-3.5 text-[var(--color-accent-text)]" />
          Balances bancarios por cuenta
        </span>
        <ChevronDown
          className={cn('size-3.5 transition-transform', !visible && '-rotate-90')}
        />
      </button>

      {visible && (
        <div className="border-t border-[var(--color-border)]">
          <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] text-[var(--color-fg-subtle)]">
              Entrante − saliente de todas las transferencias cargadas (matcheadas y sin
              matchear). No incluye las marcadas en disputa.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <CsvExportButton
                path="/tenant/bank-transactions/balances/export"
                filenameHint="bank-transactions-balances"
                permission="bank_tx.export"
                entityLabel="balances bancarios"
                variant="ghost"
                size="sm"
              />
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} />
                Refrescar
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-6">
              <EmptyState hint="bank-tx" label="Error al cargar los balances." />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState hint="bank-tx" label="Todavía no hay transferencias cargadas." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Banco · Titular</TH>
                    <TH className="text-right">Entrante</TH>
                    <TH className="text-right">Saliente</TH>
                    <TH className="text-right">Balance</TH>
                    <TH className="text-right">Transferencias</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r: BankAccountBalance, i: number) => (
                    <TR key={`${r.bankName ?? ''}-${r.accountHolder ?? ''}-${i}`}>
                      <TD className="text-[12px]">
                        {r.bankName ?? '—'}
                        {r.accountHolder && (
                          <span className="text-[var(--color-fg-subtle)]"> · {r.accountHolder}</span>
                        )}
                      </TD>
                      <TD className="text-right num font-mono text-[var(--color-success)]">
                        +{r.totalIncoming}
                      </TD>
                      <TD className="text-right num font-mono text-[var(--color-warning)]">
                        −{r.totalOutgoing}
                      </TD>
                      <TD
                        className={cn(
                          'text-right num font-mono font-medium',
                          Number(r.balance) < 0 && 'text-[var(--color-danger)]',
                        )}
                      >
                        {r.balance}
                      </TD>
                      <TD className="text-right text-[11px] text-[var(--color-fg-subtle)]">
                        {r.txCount}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
          {!canExport && (
            <p className="px-3 py-2 text-[10px] text-[var(--color-fg-subtle)] border-t border-[var(--color-border)]">
              No tenés permiso para exportar (bank_tx.export).
            </p>
          )}
        </div>
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

/** Fecha de hoy en hora AR (no la del navegador) para <input type="date">. */
function todayLocalDate(): string {
  return arTodayDateStr();
}

/** Hora actual en AR (no la del navegador) HH:MM para <input type="time">. */
function nowLocalTime(): string {
  return isoToArDatetimeLocal(new Date()).slice(11, 16);
}

/** Combina fecha + hora (calendario AR) en un ISO 8601 UTC para el backend. */
function combineDateTime(dateStr: string, timeStr: string): string {
  return arDatetimeLocalToIso(`${dateStr}T${timeStr}`) ?? new Date(`${dateStr}T${timeStr}`).toISOString();
}
