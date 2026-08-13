/**
 * /templates — editor de notification templates.
 *
 * Composición:
 *   - Header: título + counter de kinds.
 *   - Tabla: cada `kind` registrado en backend. Columna "status": default
 *     vs custom (con badge). Click row → drawer con subject/body editor +
 *     preview button.
 *
 * Concepto:
 *   - Defaults viven en el código (`notifications.templates.ts`).
 *   - Overrides viven en DB. Si `enabled=true`, el render usa el override.
 *   - "Reset" elimina el override → vuelve al default.
 */

'use client';

import { LayoutGrid, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EditTemplateDrawer } from '@/components/admin/edit-template-drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import {
  useTemplateKinds,
  useTemplateOverrides,
  type TemplateOverrideRow,
} from '@/lib/hooks/use-notification-templates';
import { cn } from '@/lib/cn';

export function SectionPlantillas() {
  const kinds = useTemplateKinds();
  const overrides = useTemplateOverrides();
  const [selectedKind, setSelectedKind] = useState<string | null>(null);

  const overrideByKind = useMemo(() => {
    const map = new Map<string, TemplateOverrideRow>();
    for (const o of overrides.data?.data ?? []) map.set(o.kind, o);
    return map;
  }, [overrides.data]);

  const isLoading = kinds.isLoading || overrides.isLoading;
  const isError = kinds.isError || overrides.isError;
  const kindsList = kinds.data?.data ?? [];

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <LayoutGrid className="size-3" />
              Configuración · Plantillas
            </span>
            <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
              Plantillas de notificaciones
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {kindsList.length > 0
                ? `${kindsList.length} kinds · ${overrideByKind.size} con override`
                : 'Cargando…'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              kinds.refetch();
              overrides.refetch();
            }}
            disabled={kinds.isFetching || overrides.isFetching}
          >
            <RefreshCw
              className={cn(
                'size-3.5',
                (kinds.isFetching || overrides.isFetching) && 'animate-spin',
              )}
            />
            Refrescar
          </Button>
        </header>

        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          {isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-10 w-full bg-[var(--color-bg-subtle)]"
                />
              ))}
            </div>
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="templates"
                label="No se pudieron cargar las plantillas."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      kinds.refetch();
                      overrides.refetch();
                    }}
                  >
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : kindsList.length === 0 ? (
            <div className="p-6">
              <EmptyState
                hint="templates"
                label="No hay kinds registrados en el backend."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Tipo</TH>
                  <TH>Estado</TH>
                  <TH>Modificado</TH>
                  <TH>Personalización activa</TH>
                </tr>
              </THead>
              <TBody>
                {kindsList.map((kind, i) => {
                  const override = overrideByKind.get(kind);
                  const hasOverride = !!override;
                  return (
                    <TR
                      key={kind}
                      onClick={() => setSelectedKind(kind)}
                      className="animate-fade-up-staggered cursor-pointer"
                      style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                    >
                      <TD>
                        <span className="text-[12px] font-mono text-[var(--color-fg)]">
                          {kind}
                        </span>
                      </TD>
                      <TD>
                        {hasOverride ? (
                          <Badge variant="success">personalizada</Badge>
                        ) : (
                          <Badge variant="neutral">predeterminada</Badge>
                        )}
                      </TD>
                      <TD numeric className="text-[var(--color-fg-subtle)]">
                        {override ? formatDate(override.updatedAt) : '—'}
                      </TD>
                      <TD>
                        {hasOverride ? (
                          <Badge
                            variant={override.enabled ? 'success' : 'warning'}
                            dot
                          >
                            {override.enabled ? 'on' : 'off'}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-[var(--color-fg-subtle)] italic">
                            n/a
                          </span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>
      </div>

      <EditTemplateDrawer
        kind={selectedKind}
        open={!!selectedKind}
        onOpenChange={(o) => !o && setSelectedKind(null)}
        currentOverride={selectedKind ? overrideByKind.get(selectedKind) : undefined}
      />
    </>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  } catch {
    return iso;
  }
}
