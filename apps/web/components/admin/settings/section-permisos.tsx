/**
 * /permissions — editor de permisos por user.
 *
 * Composición:
 *   - Toolbar superior con UserSelect (busca cualquier user del tenant).
 *   - Una vez seleccionado el user:
 *     - Card "Roles": chips de los roles asignados.
 *     - Card "Permisos efectivos": grid agrupado por categoría.
 *       Cada perm muestra su origen (rol o override grant). Los `revoke`
 *       overrides se muestran como negaciones explícitas (no aparecen en
 *       efectivos pero sí en la tabla de overrides).
 *     - Card "Overrides explícitos": tabla con effect / reason / grantedBy /
 *       grantedAt + acciones inline (Clear).
 *   - Botones header: Otorgar override · Revocar permiso.
 *
 * Permisos del operador:
 *   - Necesita `users.view_any` para entrar (aplicado en backend).
 *   - Para grant: `permissions.grant`. Para revoke/clear: `permissions.revoke`.
 *     Si no los tiene, los botones siguen visibles pero el server responde 403.
 */

'use client';

import {
  Ban,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { GrantOverrideModal } from '@/components/admin/grant-override-modal';
import { RevokeOverrideModal } from '@/components/admin/revoke-override-modal';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { UserSelect } from '@/components/ui/user-select';
import { isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  useClearOverride,
  usePermissionsCatalog,
  useUserOverrides,
  type OverrideEffect,
  type UserOverrideRow,
} from '@/lib/hooks/use-permissions';
import { useUserDetail, type TenantUserRow } from '@/lib/hooks/use-users';
import {
  getCategoryLabel,
  getPermissionLabel,
  getPermissionMeta,
  RISK_ORDER,
} from '@/lib/permission-meta';
import { cn } from '@/lib/cn';

const EFFECT_VARIANT: Record<OverrideEffect, BadgeVariant> = {
  grant: 'success',
  revoke: 'danger',
};

const EFFECT_LABEL: Record<OverrideEffect, string> = {
  grant: '+grant',
  revoke: '-revoke',
};

export function SectionPermisos() {
  const { user: actor } = useAuth();
  const [target, setTarget] = useState<TenantUserRow | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokePreset, setRevokePreset] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<UserOverrideRow | null>(null);

  const detail = useUserDetail(target?.id ?? null);
  const overrides = useUserOverrides(target?.id ?? null);
  const catalog = usePermissionsCatalog();
  const clearMutation = useClearOverride();

  const effective = detail.data?.effectivePermissions ?? [];

  // Map code → category para agrupar el grid de efectivos.
  const codeToCategory = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of catalog.data?.data ?? []) {
      map.set(p.code, p.category ?? 'otros');
    }
    return map;
  }, [catalog.data]);

  // Map code → override row para anotar origen ('override grant').
  const codeToOverride = useMemo(() => {
    const map = new Map<string, UserOverrideRow>();
    for (const o of overrides.data?.overrides ?? []) {
      map.set(o.permissionCode, o);
    }
    return map;
  }, [overrides.data]);

  // Agrupa efectivos por categoría para la grid.
  const effectiveByCategory = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const code of effective) {
      const cat = codeToCategory.get(code) ?? 'otros';
      const arr = map.get(cat) ?? [];
      arr.push(code);
      map.set(cat, arr);
    }
    // Dentro de cada categoría: por riesgo (alto primero), luego alfabético.
    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          RISK_ORDER[getPermissionMeta(a).risk] - RISK_ORDER[getPermissionMeta(b).risk] ||
          a.localeCompare(b),
      );
    }
    // Categorías: las de plata / mayor riesgo primero (docs/21 §4.5), no alfabético.
    return new Map(
      [...map.entries()].sort((a, b) => {
        const ra = Math.min(...a[1].map((c) => RISK_ORDER[getPermissionMeta(c).risk]));
        const rb = Math.min(...b[1].map((c) => RISK_ORDER[getPermissionMeta(c).risk]));
        return ra - rb || getCategoryLabel(a[0]).localeCompare(getCategoryLabel(b[0]));
      }),
    );
  }, [effective, codeToCategory]);

  const grantedCodes = useMemo(
    () =>
      (overrides.data?.overrides ?? [])
        .filter((o) => o.effect === 'grant')
        .map((o) => o.permissionCode),
    [overrides.data],
  );

  const handleClear = async () => {
    if (!clearTarget || !target) return;
    try {
      const res = await clearMutation.mutateAsync({
        userId: target.id,
        permissionCode: clearTarget.permissionCode,
      });
      toast.success('Override removido', {
        description:
          res.cascadedCount > 0
            ? `${clearTarget.permissionCode} · ${res.cascadedCount} downstream barridos`
            : `${clearTarget.permissionCode} vuelve al rol`,
      });
      setClearTarget(null);
    } catch (err) {
      toast.error('No se pudo remover', {
        description: mapError(err),
      });
    }
  };

  const refreshAll = () => {
    detail.refetch();
    overrides.refetch();
  };

  const isFetching = detail.isFetching || overrides.isFetching;

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <Layers className="size-3" />
              Sistema · Permisos
            </span>
            <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
              Editor de permisos
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              Roles + overrides explícitos. Cambios quedan en audit_log.
            </p>
          </div>
          {target && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="md"
                onClick={refreshAll}
                disabled={isFetching}
              >
                <RefreshCw
                  className={cn('size-3.5', isFetching && 'animate-spin')}
                />
                Refrescar
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setRevokePreset(null);
                  setRevokeOpen(true);
                }}
              >
                <ShieldX className="size-3.5" />
                Revocar
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => setGrantOpen(true)}
              >
                <Plus className="size-3.5" />
                Otorgar override
              </Button>
            </div>
          )}
        </header>

        {/* User selector — SIN overflow: recortaría el dropdown absoluto. */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-4">
          <div className="flex flex-col gap-2 max-w-2xl">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
              Usuario a editar
            </span>
            <UserSelect
              value={target}
              onSelect={setTarget}
              excludeUserId={actor?.id}
              placeholder="Buscá el usuario del que querés ver/editar permisos…"
            />
          </div>
        </div>

        {/* Estado vacío */}
        {!target && (
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto p-6">
            <EmptyState
              hint="user_selection"
              label="Seleccioná un usuario para empezar"
              stream="tenant · permissions editor"
            />
          </div>
        )}

        {/* Detalle del user seleccionado */}
        {target && (
          <>
            {/* Roles */}
            <Section title="Roles asignados" hint={`${detail.data?.roles.length ?? 0} rol(es)`}>
              {detail.isLoading ? (
                <Skeleton className="h-9 w-full bg-[var(--color-bg-subtle)]" />
              ) : detail.data ? (
                detail.data.roles.length > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {detail.data.roles.map((r) => (
                      <span
                        key={r.code}
                        className="inline-flex items-center gap-1.5 px-2 h-7 rounded-md text-[11px] font-mono border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] text-[var(--color-fg)]"
                      >
                        <ShieldCheck className="size-3 text-[var(--color-fg-subtle)]" />
                        {r.code}
                        <span className="text-[var(--color-fg-subtle)] text-[10px]">
                          · {r.name}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[12px] text-[var(--color-fg-subtle)] italic">
                    Sin roles asignados.
                  </span>
                )
              ) : null}
            </Section>

            {/* Overrides explícitos */}
            <Section
              title="Overrides explícitos"
              hint={
                overrides.data
                  ? `${overrides.data.count} override(s)`
                  : 'cargando…'
              }
            >
              {overrides.isLoading ? (
                <LoadingTable />
              ) : overrides.data && overrides.data.overrides.length > 0 ? (
                <Table>
                  <THead>
                    <tr>
                      <TH>Permiso</TH>
                      <TH>Efecto</TH>
                      <TH>Motivo</TH>
                      <TH>Otorgado por</TH>
                      <TH align="right">Fecha</TH>
                      <TH align="right" className="w-24"></TH>
                    </tr>
                  </THead>
                  <TBody>
                    {overrides.data.overrides.map((o, i) => (
                      <TR
                        key={o.permissionCode}
                        className="animate-fade-up-staggered"
                        style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                      >
                        <TD>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[13px] text-[var(--color-fg)] tracking-tight">
                              {getPermissionLabel(o.permissionCode)}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--color-fg-subtle)]">
                              {o.permissionCode}
                            </span>
                          </div>
                        </TD>
                        <TD>
                          <Badge variant={EFFECT_VARIANT[o.effect]} dot>
                            {EFFECT_LABEL[o.effect]}
                          </Badge>
                        </TD>
                        <TD>
                          {o.reason ? (
                            <span className="text-[12px] text-[var(--color-fg)] italic line-clamp-1">
                              "{o.reason}"
                            </span>
                          ) : (
                            <span className="text-[11px] text-[var(--color-fg-subtle)] italic">
                              —
                            </span>
                          )}
                        </TD>
                        <TD>
                          <span className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
                            {o.grantedBy ? o.grantedBy.slice(0, 13) + '…' : '—'}
                          </span>
                        </TD>
                        <TD numeric className="text-[var(--color-fg-subtle)]">
                          {formatDate(o.grantedAt)}
                        </TD>
                        <TD>
                          <div
                            className="flex items-center justify-end gap-px bg-[var(--color-border)]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {o.effect === 'grant' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRevokePreset(o.permissionCode);
                                  setRevokeOpen(true);
                                }}
                                className="size-10 flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                                aria-label="Revocar este permiso"
                                title="Revocar (negar explícitamente)"
                              >
                                <Ban className="size-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setClearTarget(o)}
                              className="size-10 flex items-center justify-center bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                              aria-label="Limpiar override"
                              title="Quitar override (volver al rol)"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <div className="px-4 py-3 text-[12px] text-[var(--color-fg-subtle)] italic">
                  Sin overrides explícitos. El user depende solo de su(s) rol(es).
                </div>
              )}
            </Section>

            {/* Permisos efectivos agrupados */}
            <Section
              title="Permisos efectivos"
              hint={`${effective.length} permiso(s)`}
            >
              {detail.isLoading || catalog.isLoading ? (
                <Skeleton className="h-32 w-full bg-[var(--color-bg-subtle)]" />
              ) : effective.length === 0 ? (
                <span className="text-[12px] text-[var(--color-fg-subtle)] italic">
                  Sin permisos efectivos.
                </span>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-[var(--color-border)]">
                  {Array.from(effectiveByCategory.entries()).map(
                    ([category, codes]) => (
                      <div
                        key={category}
                        className="bg-[var(--color-bg-elevated)] p-3 flex flex-col gap-2"
                      >
                        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
                          {getCategoryLabel(category)} · {codes.length}
                        </span>
                        <ul className="flex flex-col gap-1">
                          {codes.map((code) => {
                            const ov = codeToOverride.get(code);
                            const fromOverrideGrant =
                              ov && ov.effect === 'grant';
                            return (
                              <li
                                key={code}
                                className={cn(
                                  'flex items-center gap-2',
                                  'text-[12px]',
                                  fromOverrideGrant
                                    ? 'text-[var(--color-fg)]'
                                    : 'text-[var(--color-fg-muted)]',
                                )}
                              >
                                <span
                                  className={cn(
                                    'size-1.5 rounded-full shrink-0',
                                    fromOverrideGrant
                                      ? 'bg-[var(--color-success)]'
                                      : 'bg-[var(--color-fg-subtle)]',
                                  )}
                                />
                                <span className="truncate" title={code}>
                                  {getPermissionLabel(code)}
                                </span>
                                {fromOverrideGrant && (
                                  <span className="text-[9px] uppercase tracking-[0.08em] text-[var(--color-success)] ml-auto shrink-0">
                                    +ov
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ),
                  )}
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      {/* Modales */}
      <GrantOverrideModal
        open={grantOpen}
        onOpenChange={setGrantOpen}
        targetUser={target}
        existingGrantedCodes={grantedCodes}
      />

      <RevokeOverrideModal
        open={revokeOpen}
        onOpenChange={(o) => {
          setRevokeOpen(o);
          if (!o) setRevokePreset(null);
        }}
        targetUser={target}
        presetPermissionCode={revokePreset}
      />

      <ConfirmModal
        open={!!clearTarget}
        onOpenChange={(o) => !o && setClearTarget(null)}
        title="Quitar override"
        description={
          clearTarget
            ? `El usuario volverá a depender de su rol para "${getPermissionLabel(clearTarget.permissionCode)}".`
            : ''
        }
        warning="Si la cadena de delegación pasaba por este user, los downstream también se barren."
        confirmLabel="Quitar override"
        confirmIcon={<X className="size-3.5" />}
        confirmVariant="secondary"
        onConfirm={handleClear}
        isPending={clearMutation.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          {title}
        </span>
        {hint && (
          <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono tabular-nums">
            {hint}
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function LoadingTable() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  } catch {
    return iso;
  }
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return err.message || 'No tenés permiso.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
