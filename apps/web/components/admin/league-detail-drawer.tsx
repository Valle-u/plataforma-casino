/**
 * LeagueDetailDrawer — ver y operar sobre una league.
 *
 * Secciones:
 *   1. Header: status + período + métrica + ventana.
 *   2. Toolbar de acciones:
 *      - Editar (abre edit mode).
 *      - Recompute (idempotent — recalcula standings sin cerrar).
 *      - Cerrar y settlear (status active/scheduled → closed; entrega premios).
 *        Confirm modal porque es destructivo.
 *   3. Standings preview (top 10).
 *   4. Results table (solo si status='closed').
 *   5. Prizes/MetricConfig/Visibility JSON crudo.
 *
 * Edit mode: name, status, dates, prizes/metricConfig/visibility JSON.
 * Diff inteligente en submit.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  Calendar,
  Check,
  Eye,
  Pencil,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Drawer } from '@/components/ui/drawer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  useCloseLeague,
  useLeagueDetail,
  useLeagueResults,
  useLeagueSettlePreview,
  useLeagueStandings,
  useRecomputeLeague,
  useUpdateLeague,
  type LeagueResultRow,
  type LeagueRow,
  type LeaguePrize,
  type LeagueStatus,
  type SettlePreviewResponse,
  type StandingRow,
} from '@/lib/hooks/use-leagues';
import { cn } from '@/lib/cn';

const STATUS_OPTIONS: { value: LeagueStatus; label: string }[] = [
  { value: 'scheduled', label: 'Programada' },
  { value: 'active', label: 'Activa' },
  { value: 'closed', label: 'Cerrada' },
];

const STATUS_VARIANT: Record<LeagueStatus, BadgeVariant> = {
  scheduled: 'info',
  active: 'success',
  closed: 'neutral',
};

const STATUS_LABEL: Record<LeagueStatus, string> = {
  scheduled: 'programada',
  active: 'activa',
  closed: 'cerrada',
};

const schema = z.object({
  name: z.string().min(3, 'Mínimo 3.').max(120, 'Máximo 120.'),
  status: z.enum(['scheduled', 'active', 'closed']),
  startsAt: z.string().min(1, 'Requerido.'),
  endsAt: z.string().min(1, 'Requerido.'),
  metricConfigJson: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
  prizesJson: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
  visibilityJson: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
});

type FormValues = z.infer<typeof schema>;

function isValidJson(v: string): boolean {
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}

function parseJsonOpt(v?: string): Record<string, unknown> | undefined {
  if (!v || v.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(v);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* validado por zod */
  }
  return undefined;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function toIso(local: string): string {
  return new Date(local).toISOString();
}

interface LeagueDetailDrawerProps {
  leagueId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeagueDetailDrawer({
  leagueId,
  open,
  onOpenChange,
}: LeagueDetailDrawerProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [confirmClose, setConfirmClose] = useState(false);
  // Sprint 51.8.1: preview de qué cobraría cada uno si cerrara ahora.
  // Se carga lazy (solo cuando el admin click "Vista previa de premios").
  const [previewEnabled, setPreviewEnabled] = useState(false);

  const detail = useLeagueDetail(leagueId);
  // Sprint 51.8.1: subimos topN de 10 → 25 para que el admin vea los
  // near-misses (posiciones 11-25 que están "cerca del premio").
  const standings = useLeagueStandings(leagueId, 25);
  const results = useLeagueResults(leagueId);
  const settlePreview = useLeagueSettlePreview(leagueId, previewEnabled);
  const update = useUpdateLeague(leagueId);
  const recompute = useRecomputeLeague(leagueId);
  const close = useCloseLeague(leagueId);

  useEffect(() => {
    if (!open) setMode('view');
  }, [open]);

  useEffect(() => {
    setMode('view');
  }, [leagueId]);

  const league = detail.data;

  const isClosed = league?.status === 'closed';
  const canClose = league?.status === 'active' || league?.status === 'scheduled';

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        title={league?.name ?? 'Liga'}
        subtitle={league ? `${league.code} · ${league.period} · ${league.metric}` : leagueId ?? '—'}
        footer={
          mode === 'view' && league ? (
            <>
              <Button
                variant="secondary"
                size="md"
                type="button"
                onClick={() => onOpenChange(false)}
              >
                Cerrar
              </Button>
              <Button
                variant="primary"
                size="md"
                type="button"
                onClick={() => setMode('edit')}
              >
                <Pencil className="size-3.5" />
                Editar
              </Button>
            </>
          ) : undefined
        }
      >
        {detail.isLoading ? (
          <LoadingDetail />
        ) : detail.isError || !league ? (
          <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
            No se pudo cargar la liga.
          </div>
        ) : mode === 'view' ? (
          <ViewMode
            league={league}
            standings={standings.data}
            standingsLoading={standings.isLoading}
            results={results.data?.data}
            resultsLoading={results.isLoading}
            isClosed={isClosed}
            canClose={canClose}
            recomputePending={recompute.isPending}
            onRecompute={async () => {
              try {
                const res = await recompute.mutateAsync();
                toast.success('Standings recomputadas', {
                  description: `${res.participants} participantes`,
                });
              } catch (err) {
                toast.error('No se pudo recomputar', { description: mapError(err) });
              }
            }}
            onCloseClick={() => setConfirmClose(true)}
            previewEnabled={previewEnabled}
            preview={settlePreview.data}
            previewLoading={settlePreview.isLoading}
            onTogglePreview={() => setPreviewEnabled((v) => !v)}
          />
        ) : (
          <EditMode
            league={league}
            isPending={update.isPending}
            onCancel={() => setMode('view')}
            onSave={async (payload) => {
              try {
                await update.mutateAsync(payload);
                toast.success('Liga actualizada');
                setMode('view');
              } catch (err) {
                toast.error('No se pudo actualizar', { description: mapError(err) });
              }
            }}
          />
        )}
      </Drawer>

      <ConfirmModal
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Cerrar y settlear liga"
        description={
          league
            ? `${league.code}: recompute final + entrega premios. Status pasa a 'closed' (irreversible).`
            : ''
        }
        warning="Premios se debitan del funder. Si algún settle falla individualmente, el resto continúa (revisar reporte de skipped/failed)."
        confirmLabel="Cerrar y settlear"
        confirmIcon={<Play className="size-3.5" />}
        confirmVariant="danger"
        onConfirm={async () => {
          try {
            const res = await close.mutateAsync();
            toast.success('Liga cerrada', {
              description: `${res.totalSettled} premios · ${res.totalSkipped} skipped · ${res.totalFailed} failed`,
            });
            setConfirmClose(false);
          } catch (err) {
            toast.error('No se pudo cerrar', { description: mapError(err) });
          }
        }}
        isPending={close.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// View mode
// ──────────────────────────────────────────────────────────────────────

function ViewMode({
  league,
  standings,
  standingsLoading,
  results,
  resultsLoading,
  isClosed,
  canClose,
  recomputePending,
  onRecompute,
  onCloseClick,
  previewEnabled,
  preview,
  previewLoading,
  onTogglePreview,
}: {
  league: LeagueRow;
  standings: { top: StandingRow[]; around?: StandingRow[]; total: number } | undefined;
  standingsLoading: boolean;
  results: LeagueResultRow[] | undefined;
  resultsLoading: boolean;
  isClosed: boolean;
  canClose: boolean;
  recomputePending: boolean;
  onRecompute: () => void;
  onCloseClick: () => void;
  previewEnabled: boolean;
  preview: SettlePreviewResponse | undefined;
  previewLoading: boolean;
  onTogglePreview: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Status + ventana */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Estado">
          <Badge variant={STATUS_VARIANT[league.status]} dot>
            {STATUS_LABEL[league.status]}
          </Badge>
        </Field>
        <Field label="Métrica">
          <span className="text-[12px] font-mono text-[var(--color-fg)]">
            {league.metric}
          </span>
        </Field>
        <Field label="Empieza">
          <DateLine iso={league.startsAt} />
        </Field>
        <Field label="Termina">
          <DateLine iso={league.endsAt} />
        </Field>
      </div>

      {/* Acciones admin */}
      {!isClosed && (
        <div className="flex items-center gap-2 p-3 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] flex-wrap">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRecompute}
            disabled={recomputePending}
          >
            <RefreshCw
              className={cn('size-3.5', recomputePending && 'animate-spin')}
            />
            Recomputar
          </Button>
          {/* Sprint 51.8.1: toggle preview de premios pre-close */}
          <Button
            variant={previewEnabled ? 'primary' : 'secondary'}
            size="sm"
            onClick={onTogglePreview}
            title="Mostrar qué premio cobraría cada uno si cerraras ahora — read-only"
          >
            <Eye className="size-3.5" />
            {previewEnabled ? 'Ocultar preview' : 'Vista previa de premios'}
          </Button>
          {canClose && (
            <Button variant="outline-accent" size="sm" onClick={onCloseClick}>
              <Play className="size-3.5" />
              Cerrar y settlear
            </Button>
          )}
        </div>
      )}

      {/* Sprint 51.8.1: panel de preview cuando está activo */}
      {previewEnabled && (
        <SettlePreviewPanel preview={preview} loading={previewLoading} />
      )}

      {/* Standings preview */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
            Standings · top 25
          </span>
          {standings && (
            <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono tabular-nums">
              {standings.total} participantes
            </span>
          )}
        </div>
        {standingsLoading ? (
          <Skeleton className="h-32 w-full bg-[var(--color-bg-subtle)]" />
        ) : !standings || standings.top.length === 0 ? (
          <div className="px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] text-[12px] text-[var(--color-fg-subtle)] italic">
            Sin participantes todavía.
          </div>
        ) : (
          <StandingsTable rows={standings.top} />
        )}
      </div>

      {/* Results (solo si closed) */}
      {isClosed && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
              Premios entregados
            </span>
            {results && (
              <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono tabular-nums">
                {results.length} payouts
              </span>
            )}
          </div>
          {resultsLoading ? (
            <Skeleton className="h-32 w-full bg-[var(--color-bg-subtle)]" />
          ) : !results || results.length === 0 ? (
            <div className="px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] text-[12px] text-[var(--color-fg-subtle)] italic">
              Cerrada sin premios entregados (sin participantes elegibles).
            </div>
          ) : (
            <ResultsTable rows={results} />
          )}
        </div>
      )}

      <Field label="Prizes">
        <JsonBox value={league.prizes} />
      </Field>

      {league.metric === 'score_custom' && (
        <Field label="Metric config">
          <JsonBox value={league.metricConfig} />
        </Field>
      )}

      <Field label="Visibility">
        <JsonBox value={league.visibility} />
      </Field>

      <Field label="Funder">
        <span className="text-[11px] font-mono text-[var(--color-fg-subtle)] break-all">
          {league.fundedByUserId}
        </span>
      </Field>

      <Field label="Timestamps">
        <div className="flex flex-col gap-0.5 text-[11px] font-mono text-[var(--color-fg-subtle)]">
          <span>created: {formatFull(league.createdAt)}</span>
          <span>updated: {formatFull(league.updatedAt)}</span>
        </div>
      </Field>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit mode
// ──────────────────────────────────────────────────────────────────────

function EditMode({
  league,
  isPending,
  onCancel,
  onSave,
}: {
  league: LeagueRow;
  isPending: boolean;
  onCancel: () => void;
  onSave: (payload: {
    name?: string;
    status?: LeagueStatus;
    startsAt?: string;
    endsAt?: string;
    metricConfig?: Record<string, unknown>;
    prizes?: Record<string, unknown>;
    visibility?: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const defaults = useMemo<FormValues>(
    () => ({
      name: league.name,
      status: league.status,
      startsAt: toLocalInput(league.startsAt),
      endsAt: toLocalInput(league.endsAt),
      metricConfigJson: JSON.stringify(league.metricConfig, null, 2),
      prizesJson: JSON.stringify(league.prizes, null, 2),
      visibilityJson: JSON.stringify(league.visibility, null, 2),
    }),
    [league],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    reset(defaults);
  }, [defaults, reset]);

  const onSubmit = handleSubmit(async (values) => {
    await onSave({
      name: values.name !== league.name ? values.name : undefined,
      status:
        values.status !== league.status
          ? (values.status)
          : undefined,
      startsAt:
        toIso(values.startsAt) !== league.startsAt
          ? toIso(values.startsAt)
          : undefined,
      endsAt:
        toIso(values.endsAt) !== league.endsAt
          ? toIso(values.endsAt)
          : undefined,
      metricConfig: jsonChanged(values.metricConfigJson, league.metricConfig)
        ? parseJsonOpt(values.metricConfigJson)
        : undefined,
      prizes: jsonChanged(values.prizesJson, league.prizes)
        ? parseJsonOpt(values.prizesJson)
        : undefined,
      visibility: jsonChanged(values.visibilityJson, league.visibility)
        ? parseJsonOpt(values.visibilityJson)
        : undefined,
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormField id="ld-name" label="Nombre" required error={errors.name?.message}>
        <Input id="ld-name" type="text" invalid={!!errors.name} {...register('name')} />
      </FormField>

      <FormField
        id="ld-status"
        label="Estado"
        required
        error={errors.status?.message}
        hint="Pasar a 'closed' acá NO settlea premios (usar el botón 'Cerrar y settlear')."
      >
        <Select id="ld-status" invalid={!!errors.status} {...register('status')}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="grid grid-cols-1 gap-4">
        <FormField id="ld-starts" label="Empieza" required error={errors.startsAt?.message}>
          <Input
            id="ld-starts"
            type="datetime-local"
            invalid={!!errors.startsAt}
            {...register('startsAt')}
          />
        </FormField>
        <FormField id="ld-ends" label="Termina" required error={errors.endsAt?.message}>
          <Input
            id="ld-ends"
            type="datetime-local"
            invalid={!!errors.endsAt}
            {...register('endsAt')}
          />
        </FormField>
      </div>

      <FormField
        id="ld-metric-config"
        label="Metric config (JSON)"
        error={errors.metricConfigJson?.message}
      >
        <textarea
          id="ld-metric-config"
          rows={4}
          aria-invalid={!!errors.metricConfigJson}
          className={textareaClass(!!errors.metricConfigJson)}
          {...register('metricConfigJson')}
        />
      </FormField>

      <FormField
        id="ld-prizes"
        label="Prizes (JSON)"
        error={errors.prizesJson?.message}
      >
        <textarea
          id="ld-prizes"
          rows={5}
          aria-invalid={!!errors.prizesJson}
          className={textareaClass(!!errors.prizesJson)}
          {...register('prizesJson')}
        />
      </FormField>

      <FormField
        id="ld-visibility"
        label="Visibility (JSON)"
        error={errors.visibilityJson?.message}
      >
        <textarea
          id="ld-visibility"
          rows={3}
          aria-invalid={!!errors.visibilityJson}
          className={textareaClass(!!errors.visibilityJson)}
          {...register('visibilityJson')}
        />
      </FormField>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
        <Button
          variant="secondary"
          size="md"
          type="button"
          onClick={onCancel}
          disabled={isPending}
        >
          <X className="size-3.5" />
          Cancelar
        </Button>
        <Button
          variant="primary"
          size="md"
          type="submit"
          disabled={!isDirty || isPending}
        >
          {isPending ? (
            <>
              <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
              Guardando…
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              Guardar
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function jsonChanged(s: string | undefined, obj: Record<string, unknown>): boolean {
  if (!s) return Object.keys(obj).length > 0;
  try {
    return JSON.stringify(JSON.parse(s)) !== JSON.stringify(obj);
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function StandingsTable({ rows }: { rows: StandingRow[] }) {
  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-bg)] divide-y divide-[var(--color-border)]">
      {rows.map((r) => (
        <div
          key={r.userId}
          className="grid grid-cols-[40px_1fr_auto] gap-3 px-3 py-1.5 items-center"
        >
          <span
            className={cn(
              'text-[11px] font-mono tabular-nums',
              r.position <= 3
                ? 'text-[var(--color-accent-text)] font-medium'
                : 'text-[var(--color-fg-subtle)]',
            )}
          >
            #{r.position}
          </span>
          <div className="flex flex-col gap-0 min-w-0">
            <span className="text-[12px] text-[var(--color-fg)] truncate">
              {r.displayName ?? r.username ?? r.userId.slice(0, 13) + '…'}
            </span>
            {r.username && r.displayName && (
              <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] truncate">
                @{r.username}
              </span>
            )}
          </div>
          <span className="text-[12px] font-mono tabular-nums text-[var(--color-fg)]">
            {r.score}
          </span>
        </div>
      ))}
    </div>
  );
}

function ResultsTable({ rows }: { rows: LeagueResultRow[] }) {
  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-bg)] divide-y divide-[var(--color-border)] max-h-[260px] overflow-y-auto">
      {rows.map((r) => (
        <div
          key={r.id}
          className="grid grid-cols-[40px_1fr_auto] gap-3 px-3 py-2 items-start"
        >
          <span
            className={cn(
              'text-[11px] font-mono tabular-nums shrink-0 mt-0.5',
              r.finalPosition <= 3
                ? 'text-[var(--color-accent-text)] font-medium'
                : 'text-[var(--color-fg-subtle)]',
            )}
          >
            #{r.finalPosition}
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] font-mono text-[var(--color-fg)] truncate">
              {r.userId.slice(0, 13)}…
            </span>
            <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] truncate">
              score: {r.finalScore}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 items-end shrink-0">
            <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
              {formatPrize(r.prize)}
            </span>
            {r.walletTxId && <Badge variant="success">fichas</Badge>}
            {r.bonusId && !r.walletTxId && <Badge variant="info">bonus</Badge>}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatPrize(prize: unknown): string {
  if (!prize || typeof prize !== 'object') return '—';
  const p = prize as { kind?: string; amount?: string | number };
  if (p.kind && p.amount !== undefined) return `${p.amount} ${p.kind}`;
  if (p.kind) return p.kind;
  return JSON.stringify(p).slice(0, 30);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      {children}
    </div>
  );
}

function DateLine({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-fg)] font-mono">
      <Calendar className="size-3 text-[var(--color-fg-subtle)]" />
      {formatFull(iso)}
    </div>
  );
}

function JsonBox({ value }: { value: unknown }) {
  let formatted: string;
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    formatted = String(value);
  }
  if (formatted === '{}' || formatted === 'null') {
    return (
      <span className="text-[11px] text-[var(--color-fg-subtle)] italic">vacío</span>
    );
  }
  return (
    <pre className="text-[11px] font-mono leading-relaxed bg-[var(--color-bg)] border border-[var(--color-border)] p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-[var(--color-fg)]">
      {formatted}
    </pre>
  );
}

function LoadingDetail() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function textareaClass(invalid: boolean): string {
  return cn(
    'flex w-full px-3 py-2 resize-y',
    'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
    'border border-[var(--color-border)]',
    'placeholder:text-[var(--color-fg-subtle)]',
    'text-[12px] leading-relaxed font-mono',
    'transition-[border-color,box-shadow] duration-150',
    'hover:border-[var(--color-border-strong)]',
    'focus:outline-none focus:border-[var(--color-accent)]',
    'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
    invalid && 'border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-glow)]',
  );
}

function formatFull(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso para esta operación.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  if (err.status === 404) return 'La liga ya no existe.';
  if (err.status === 409) return err.message || 'La liga no se puede cerrar en este estado.';
  return err.message || 'Error inesperado.';
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.8.1: preview de premios pre-close
// ──────────────────────────────────────────────────────────────────────

function SettlePreviewPanel({
  preview,
  loading,
}: {
  preview: SettlePreviewResponse | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Skeleton className="h-40 w-full bg-[var(--color-bg-subtle)]" />
    );
  }
  if (!preview) {
    return (
      <div className="px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] text-[12px] text-[var(--color-fg-subtle)] italic">
        Sin datos de preview (¿hay standings? probá recompute primero).
      </div>
    );
  }
  const withPrize = preview.standings.filter((s) => s.prize !== null);
  const unassigned = preview.prizesUnassigned;
  return (
    <section className="flex flex-col gap-3 p-4 bg-[var(--color-bg)] border border-[var(--color-accent-border)] border-l-2 border-l-[var(--color-accent)]">
      <div className="flex items-center gap-2">
        <Eye className="size-3.5 text-[var(--color-accent-text)]" />
        <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
          Vista previa de premios (si cerraras ahora)
        </span>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="px-2 py-1.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
            Participants
          </div>
          <div className="font-mono tabular-nums text-[var(--color-fg)]">
            {preview.summary.totalParticipants}
          </div>
        </div>
        <div className="px-2 py-1.5 bg-[var(--color-success-bg)] border border-[var(--color-success)]">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-success)]">
            Cobran premio
          </div>
          <div className="font-mono tabular-nums text-[var(--color-fg)]">
            {preview.summary.withPrize}
          </div>
        </div>
        <div className="px-2 py-1.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
            Fichas a entregar
          </div>
          <div className="font-mono tabular-nums text-[var(--color-fg)]">
            {preview.summary.totalChipsToAward.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Warning: prizes en posiciones que nadie alcanza */}
      {unassigned.length > 0 && (
        <div className="flex items-start gap-2 p-2 bg-[var(--color-warning-bg)] border border-[var(--color-warning)] text-[11px]">
          <AlertTriangle className="size-3.5 text-[var(--color-warning)] shrink-0 mt-px" />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[var(--color-warning)] font-medium">
              {unassigned.length} premio{unassigned.length === 1 ? '' : 's'} sin asignar
            </span>
            <span className="text-[var(--color-fg-muted)]">
              Posiciones{' '}
              {unassigned
                .slice(0, 6)
                .map((u) => `#${u.position}`)
                .join(', ')}
              {unassigned.length > 6 ? '…' : ''}{' '}
              no tienen participants — quedarían sin entregar.
            </span>
          </div>
        </div>
      )}

      {/* Listado de quién cobra qué */}
      {withPrize.length === 0 ? (
        <div className="px-3 py-2 bg-[var(--color-bg-elevated)] border border-dashed border-[var(--color-border)] text-[11px] text-[var(--color-fg-subtle)] italic">
          Ningún participant entra en zona de premios.
        </div>
      ) : (
        <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
          {withPrize.slice(0, 30).map((s) => (
            <div
              key={`${s.position}-${s.userId}`}
              className="flex items-center justify-between gap-2 px-2 py-1.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[12px]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'font-mono text-[11px] w-7 text-right',
                    s.position === 1
                      ? 'text-[var(--color-warning)]'
                      : s.position <= 3
                        ? 'text-[var(--color-accent-text)]'
                        : 'text-[var(--color-fg-muted)]',
                  )}
                >
                  #{s.position}
                </span>
                <span className="text-[12px] text-[var(--color-fg)] truncate">
                  {s.displayName ?? s.username ?? s.userId.slice(0, 13) + '…'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                  {s.score}
                </span>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">·</span>
                <PrizeChip prize={s.prize!} />
              </div>
            </div>
          ))}
          {withPrize.length > 30 && (
            <div className="text-center text-[10px] text-[var(--color-fg-subtle)] py-1">
              +{withPrize.length - 30} más
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PrizeChip({ prize }: { prize: LeaguePrize }) {
  if (prize.kind === 'chips') {
    return (
      <span className="font-mono text-[11px] text-[var(--color-success)] tabular-nums">
        {Number(prize.amount).toLocaleString()} fichas
      </span>
    );
  }
  if (prize.kind === 'bonus') {
    return (
      <span className="font-mono text-[11px] text-[var(--color-accent-text)] tabular-nums">
        bonus {Number(prize.amount).toLocaleString()}
      </span>
    );
  }
  if (prize.kind === 'free_spins') {
    return (
      <span className="font-mono text-[11px] text-[var(--color-accent-text)]">
        {prize.count} free spins
      </span>
    );
  }
  return (
    <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
      try again
    </span>
  );
}
