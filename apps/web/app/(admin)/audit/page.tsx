/**
 * /audit — timeline append-only del tenant.
 *
 * Composición:
 *   - Header con título + counter de entries en la vista actual.
 *   - Toolbar de filtros: prefix de dominio (wallet., bonus., etc.),
 *     rango de fechas, búsqueda libre por actionCode exacto.
 *   - Timeline vertical: cada entry es una "row" con timestamp + actor
 *     + actionCode (badge color por dominio) + targetType:targetId mono
 *     + reason (si está). Click en la entry abre drawer con before/after
 *     y metadata en JSON crudo.
 *   - Pager simple (limit 50/100, offset).
 *
 * El audit_log es append-only — no hay mutations en este page.
 */

'use client';

import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  Filter,
  RefreshCw,
  ScrollText,
  Search,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { HelpNote } from '@/components/ui/help-note';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuditLog, type AuditEntry } from '@/lib/hooks/use-audit';
import { cn } from '@/lib/cn';
import { arDatetimeLocalToIso } from '@/lib/format-date';

const PAGE_SIZES = [50, 100, 200] as const;

interface DomainFilter {
  id: string;
  label: string;
  prefix?: string;
  variant: BadgeVariant;
}

/**
 * Prefijos de dominio que existen en el backend hoy. Suma uno cuando el
 * backend empiece a registrar un nuevo dominio.
 */
const DOMAIN_FILTERS: DomainFilter[] = [
  { id: 'all', label: 'Todos', variant: 'neutral' },
  { id: 'wallet', label: 'Wallet', prefix: 'wallet.', variant: 'success' },
  { id: 'bonus', label: 'Bonos', prefix: 'bonus.', variant: 'info' },
  { id: 'deposits', label: 'Depósitos', prefix: 'deposits.', variant: 'success' },
  { id: 'withdrawals', label: 'Retiros', prefix: 'withdrawals.', variant: 'warning' },
  { id: 'users', label: 'Usuarios', prefix: 'users.', variant: 'neutral' },
  {
    id: 'permissions',
    label: 'Permisos',
    prefix: 'permissions.',
    variant: 'danger',
  },
  { id: 'auth', label: 'Auth/2FA', prefix: 'auth.', variant: 'warning' },
  { id: 'fraud', label: 'Fraude', prefix: 'fraud.', variant: 'danger' },
  { id: 'tenant', label: 'Tenant', prefix: 'tenant.', variant: 'neutral' },
  { id: 'league', label: 'Ligas', prefix: 'league.', variant: 'info' },
  {
    id: 'promotion',
    label: 'Promos',
    prefix: 'promotion.',
    variant: 'info',
  },
];

/** Dominios destructivos / que merecen color rojo aunque el grupo sea neutro. */
const DANGER_ACTION_KEYWORDS = [
  'cancel',
  'reject',
  'failed',
  'revoke',
  'cascade_revoke',
  'clear_parent',
  'role_remove',
  'unset',
  'disabled',
  'burn',
  'unload',
  'force_clear',
  'fraud_blocked',
  'fraud_warning',
];

export default function AuditPage() {
  const [domainId, setDomainId] = useState<string>('all');
  const [actionCodeQuery, setActionCodeQuery] = useState('');
  const [actorIdQuery, setActorIdQuery] = useState('');
  const [targetIdQuery, setTargetIdQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(0);
  const [openDetail, setOpenDetail] = useState<AuditEntry | null>(null);

  const domain = useMemo(
    () => DOMAIN_FILTERS.find((d) => d.id === domainId) ?? DOMAIN_FILTERS[0]!,
    [domainId],
  );

  const filters = useMemo(
    () => ({
      actionCodePrefix: domain.prefix,
      actionCode: actionCodeQuery.trim() || undefined,
      actorUserId: actorIdQuery.trim() || undefined,
      targetId: targetIdQuery.trim() || undefined,
      fromDate: arDatetimeLocalToIso(fromDate),
      toDate: arDatetimeLocalToIso(toDate),
      limit: pageSize,
      offset: page * pageSize,
      order: 'desc' as const,
    }),
    [
      domain.prefix,
      actionCodeQuery,
      actorIdQuery,
      targetIdQuery,
      fromDate,
      toDate,
      pageSize,
      page,
    ],
  );

  const { data, isLoading, isError, refetch, isFetching } = useAuditLog(filters);
  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;

  const hasFilters =
    domain.id !== 'all' ||
    !!actionCodeQuery ||
    !!actorIdQuery ||
    !!targetIdQuery ||
    !!fromDate ||
    !!toDate;

  const clearFilters = () => {
    setDomainId('all');
    setActionCodeQuery('');
    setActorIdQuery('');
    setTargetIdQuery('');
    setFromDate('');
    setToDate('');
    setPage(0);
  };

  return (
    <>
      <PageShell>
        {/* Header */}
        <PageHeader
          icon={ScrollText}
          title="Registro de actividad"
          description={
            data
              ? `Cada acción importante queda registrada acá. ${entries.length} de ${total} en esta vista.`
              : 'Cargando…'
          }
          actions={
            <>
              <CsvExportButton
                path="/tenant/audit-log/export"
                params={{
                  actionCodePrefix: domain.prefix,
                  actionCode: actionCodeQuery.trim() || undefined,
                  actorUserId: actorIdQuery.trim() || undefined,
                  targetId: targetIdQuery.trim() || undefined,
                  fromDate: arDatetimeLocalToIso(fromDate),
                  toDate: arDatetimeLocalToIso(toDate),
                  order: 'desc',
                }}
                filenameHint="audit_log"
                permission="audit.export"
                entityLabel="registro de actividad"
              />
              <Button
                variant="secondary"
                size="md"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw
                  className={cn('size-3.5', isFetching && 'animate-spin')}
                />
                Refrescar
              </Button>
            </>
          }
        />

        <HelpNote id="audit">
          Este es el <strong>diario del casino</strong>: cada acción importante
          que hace cualquier persona (crear un usuario, aprobar un depósito,
          cambiar una comisión, cargar fichas…) queda <strong>registrada</strong>{' '}
          con <strong>quién la hizo, qué hizo y cuándo</strong>. No se puede{' '}
          <strong>borrar ni editar</strong> — solo se agregan cosas nuevas — y por
          eso sirve para <strong>revisar qué pasó</strong> si algo no cierra.
          Podés filtrar por tipo, por persona o por fecha, y tocar cualquier
          línea para ver el detalle.
        </HelpNote>

        {/* Domain tabs */}
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] overflow-x-auto hide-scrollbar max-w-full sm:self-start">
          {DOMAIN_FILTERS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setDomainId(d.id);
                setPage(0);
              }}
              className={cn(
                'shrink-0 whitespace-nowrap px-3 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
                'transition-colors duration-150',
                domainId === d.id
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Sprint 51.3: quick chips para escenarios de auditoría puntuales.
            Setean los filtros principales para acceder rápido a casos
            sensibles. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
            Atajos
          </span>
          <button
            type="button"
            onClick={() => {
              setDomainId('bonus');
              setActionCodeQuery('bonus.grant_manual.cross_branch');
              setPage(0);
            }}
            className={cn(
              'px-2.5 h-7 text-[11px] uppercase tracking-[0.06em] font-medium border flex items-center gap-1.5 transition-colors',
              actionCodeQuery === 'bonus.grant_manual.cross_branch'
                ? 'bg-[var(--color-warning-bg)] text-[var(--color-warning)] border-[var(--color-warning)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-warning)] hover:text-[var(--color-warning)]',
            )}
            title="Bonos otorgados por el admin del tenant a players bajo socios independent (escape hatch)"
          >
            <AlertTriangle className="size-3" />
            Cross-branch grants
          </button>
        </div>

        {/* Filters bar */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormField
            id="aud-action"
            label="Action code exacto"
            hint="Ej: wallet.burn"
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
              <Input
                id="aud-action"
                type="text"
                value={actionCodeQuery}
                placeholder="wallet.burn"
                onChange={(e) => {
                  setActionCodeQuery(e.target.value);
                  setPage(0);
                }}
                className="pl-9 font-mono"
              />
            </div>
          </FormField>

          <FormField id="aud-actor" label="Actor (user id)" hint="UUID exacto">
            <Input
              id="aud-actor"
              type="text"
              value={actorIdQuery}
              placeholder="0193…"
              onChange={(e) => {
                setActorIdQuery(e.target.value);
                setPage(0);
              }}
              className="font-mono"
            />
          </FormField>

          <FormField id="aud-target" label="Target id" hint="UUID exacto">
            <Input
              id="aud-target"
              type="text"
              value={targetIdQuery}
              placeholder="0193…"
              onChange={(e) => {
                setTargetIdQuery(e.target.value);
                setPage(0);
              }}
              className="font-mono"
            />
          </FormField>

          <FormField id="aud-page-size" label="Por página">
            <Select
              id="aud-page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} entries
                </option>
              ))}
            </Select>
          </FormField>

          <FormField id="aud-from" label="Desde" hint="Local time">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
              <Input
                id="aud-from"
                type="datetime-local"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>
          </FormField>

          <FormField id="aud-to" label="Hasta" hint="Local time">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
              <Input
                id="aud-to"
                type="datetime-local"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>
          </FormField>

          <div className="md:col-span-2 lg:col-span-2 flex items-end justify-end gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="size-3.5" />
                Limpiar filtros
              </Button>
            )}
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5 px-2">
              <Filter className="size-3" />
              {hasFilters ? 'filtros activos' : 'sin filtros'}
            </span>
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          {isLoading ? (
            <LoadingTimeline />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="audit_log"
                label="No se pudo cargar el registro."
                action={
                  <Button variant="secondary" size="sm" onClick={() => refetch()}>
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : entries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                hint="audit_log"
                stream={`tenant · ${domain.prefix ?? 'all'}`}
                label={
                  hasFilters
                    ? 'Sin entries para este filtro'
                    : 'El audit log está vacío'
                }
                action={
                  hasFilters ? (
                    <Button variant="secondary" size="sm" onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ol className="flex flex-col">
              {entries.map((e, i) => (
                <li key={e.id}>
                  <TimelineRow
                    entry={e}
                    onClick={() => setOpenDetail(e)}
                    last={i === entries.length - 1}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Pager */}
        {data && total > pageSize && (
          <Pager
            page={page}
            total={total}
            pageSize={pageSize}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            hasMore={(page + 1) * pageSize < total}
          />
        )}
      </PageShell>

      {/* Drawer detalle */}
      <AuditDetailDrawer
        entry={openDetail}
        open={!!openDetail}
        onOpenChange={(o) => !o && setOpenDetail(null)}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// TimelineRow
// ──────────────────────────────────────────────────────────────────────

function TimelineRow({
  entry,
  onClick,
  last,
}: {
  entry: AuditEntry;
  onClick: () => void;
  last: boolean;
}) {
  const variant = pickActionVariant(entry.actionCode);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-4 px-5 py-3 text-left',
        'hover:bg-[var(--color-bg-subtle)] transition-colors',
        'border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]',
        !last && 'border-b border-[var(--color-border)]',
      )}
    >
      {/* Timestamp + dot rail */}
      <div className="flex flex-col items-end gap-1 shrink-0 w-[120px]">
        <span className="text-[11px] font-mono tabular-nums text-[var(--color-fg)]">
          {formatTime(entry.createdAt)}
        </span>
        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
          {formatDate(entry.createdAt)}
        </span>
      </div>

      <div className="shrink-0 mt-1.5">
        <span
          className={cn(
            'block size-2 border',
            variant === 'danger' && 'bg-[var(--color-accent)] border-[var(--color-accent)]',
            variant === 'success' &&
              'bg-[var(--color-success)] border-[var(--color-success)]',
            variant === 'warning' &&
              'bg-[var(--color-warning)] border-[var(--color-warning)]',
            variant === 'info' && 'bg-[#06b6d4] border-[#06b6d4]',
            variant === 'neutral' &&
              'bg-[var(--color-bg-elevated)] border-[var(--color-border-strong)]',
          )}
        />
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={variant} dot>
            {entry.actionCode}
          </Badge>
          {entry.actorRoleAtTime && (
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-mono">
              [{entry.actorRoleAtTime}]
            </span>
          )}
          {entry.impersonatorId && (
            <Badge variant="warning">impersonate</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)] flex-wrap">
          <span className="text-[var(--color-fg)] truncate max-w-[200px]">
            {entry.actorUsername ? `@${entry.actorUsername}` : 'sistema'}
          </span>
          {entry.targetType && entry.targetId && (
            <>
              <ChevronRight className="size-3 text-[var(--color-fg-subtle)]" />
              <span className="font-mono text-[11px] text-[var(--color-fg-subtle)] truncate">
                {entry.targetType}:{entry.targetId.slice(0, 13)}…
              </span>
            </>
          )}
        </div>

        {entry.reason && (
          <p className="text-[12px] text-[var(--color-fg)] italic line-clamp-2">
            “{entry.reason}”
          </p>
        )}
      </div>

      <ChevronRight className="size-4 text-[var(--color-fg-subtle)] shrink-0 mt-1" />
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Detail drawer — JSON crudo
// ──────────────────────────────────────────────────────────────────────

function AuditDetailDrawer({
  entry,
  open,
  onOpenChange,
}: {
  entry: AuditEntry | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={entry?.actionCode ?? 'Audit entry'}
      subtitle={entry ? `${entry.id}` : undefined}
    >
      {entry && (
        <div className="flex flex-col gap-5">
          <DetailField label="Actor">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] text-[var(--color-fg)]">
                {entry.actorUsername ?? 'sistema'}
              </span>
              <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
                {entry.actorUserId ?? 'system event'}
                {entry.actorRoleAtTime && ` · [${entry.actorRoleAtTime}]`}
              </span>
            </div>
          </DetailField>

          <DetailField label="Target">
            {entry.targetType || entry.targetId ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] text-[var(--color-fg)]">
                  {entry.targetType ?? '—'}
                </span>
                <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] break-all">
                  {entry.targetId ?? '—'}
                </span>
              </div>
            ) : (
              <span className="text-[12px] text-[var(--color-fg-subtle)] italic">
                Sin target
              </span>
            )}
          </DetailField>

          <DetailField label="Timestamp">
            <span className="text-[13px] font-mono text-[var(--color-fg)]">
              {formatFull(entry.createdAt)}
            </span>
          </DetailField>

          {entry.reason && (
            <DetailField label="Motivo">
              <p className="text-[13px] text-[var(--color-fg)] italic">
                “{entry.reason}”
              </p>
            </DetailField>
          )}

          <DetailField label="Before">
            <JsonBlock value={entry.before} />
          </DetailField>

          <DetailField label="After">
            <JsonBlock value={entry.after} />
          </DetailField>

          <DetailField label="Metadata">
            <JsonBlock value={entry.metadata} />
          </DetailField>

          <DetailField label="Contexto">
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-[var(--color-fg-muted)]">
              <ContextItem label="ip" value={entry.ip} />
              <ContextItem label="request" value={entry.requestId} />
              <ContextItem label="session" value={entry.sessionId} />
              <ContextItem label="impersonator" value={entry.impersonatorId} />
            </div>
            {entry.userAgent && (
              <div className="mt-2 text-[10px] font-mono text-[var(--color-fg-subtle)] break-all">
                ua · {entry.userAgent}
              </div>
            )}
          </DetailField>
        </div>
      )}
    </Drawer>
  );
}

function DetailField({
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

function ContextItem({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span
        className={cn(
          'truncate',
          value ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-subtle)] italic',
        )}
        title={value ?? undefined}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-[12px] text-[var(--color-fg-subtle)] italic">
        null
      </span>
    );
  }
  let formatted: string;
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    // Cyclic refs u objeto raro — fallback explícito sin "[object Object]".
    formatted = '[unserializable]';
  }
  return (
    <pre className="text-[11px] font-mono leading-relaxed bg-[var(--color-bg)] border border-[var(--color-border)] p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-[280px] overflow-y-auto text-[var(--color-fg)]">
      {formatted}
    </pre>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Pager + skeleton
// ──────────────────────────────────────────────────────────────────────

function Pager({
  page,
  total,
  pageSize,
  onPrev,
  onNext,
  hasMore,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  hasMore: boolean;
}) {
  const start = page * pageSize + 1;
  const end = Math.min(start + pageSize - 1, total);
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function LoadingTimeline() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function pickActionVariant(actionCode: string): BadgeVariant {
  for (const kw of DANGER_ACTION_KEYWORDS) {
    if (actionCode.includes(kw)) return 'danger';
  }
  for (const d of DOMAIN_FILTERS) {
    if (d.prefix && actionCode.startsWith(d.prefix)) return d.variant;
  }
  return 'neutral';
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return iso;
  }
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
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}
