/**
 * Configuración · Plantillas — los mensajes automáticos que el casino manda.
 *
 * Vista en criollo: tarjetas agrupadas por tema (Depósitos, Retiros, Bonos,
 * Seguridad, Operación). Cada tarjeta muestra el nombre humano del aviso,
 * cuándo se envía, si está Personalizado o usa el texto Predeterminado, y un
 * botón "Personalizar" que abre el editor amigable.
 *
 * Concepto: los textos por defecto viven en el código del backend; los
 * personalizados (overrides) viven en la DB. Este panel solo lee
 * `useTemplateKinds` (qué avisos existen) + `useTemplateOverrides` (cuáles
 * personalizaste) y los presenta con el catálogo criollo `notification-kinds-meta`.
 */

'use client';

import { LayoutGrid, Pencil, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EditTemplateDrawer } from '@/components/admin/edit-template-drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useTemplateKinds,
  useTemplateOverrides,
  type TemplateOverrideRow,
} from '@/lib/hooks/use-notification-templates';
import {
  CATEGORY_ORDER,
  getKindMeta,
  type NotifCategory,
} from '@/lib/notification-kinds-meta';
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

  // Agrupar los kinds registrados por categoría criolla.
  const grouped = useMemo(() => {
    const map = new Map<NotifCategory, string[]>();
    for (const kind of kindsList) {
      // Ocultar el evento de prueba interno.
      if (kind === 'test_event') continue;
      const meta = getKindMeta(kind);
      const list = map.get(meta.category) ?? [];
      list.push(kind);
      map.set(meta.category, list);
    }
    return map;
  }, [kindsList]);

  const customCount = useMemo(
    () => kindsList.filter((k) => k !== 'test_event' && overrideByKind.has(k)).length,
    [kindsList, overrideByKind],
  );

  const refetchAll = () => {
    kinds.refetch();
    overrides.refetch();
  };

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
              Mensajes automáticos
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1 max-w-2xl">
              Estos son los avisos que el casino manda solo (por ejemplo, cuando
              aprobás un depósito o un jugador pide un retiro). Cada uno tiene un
              texto que viene por defecto; podés personalizarlo o dejar el que viene.
            </p>
          </div>
          <Button
            variant="secondary"
            size="md"
            onClick={refetchAll}
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

        {isLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full bg-[var(--color-bg-subtle)]" />
            ))}
          </div>
        ) : isError ? (
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-6">
            <EmptyState
              hint="templates"
              label="No se pudieron cargar los mensajes."
              action={
                <Button variant="secondary" size="sm" onClick={refetchAll}>
                  Reintentar
                </Button>
              }
            />
          </div>
        ) : grouped.size === 0 ? (
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-6">
            <EmptyState hint="templates" label="No hay mensajes configurables." />
          </div>
        ) : (
          <>
            <p className="text-[12px] text-[var(--color-fg-subtle)]">
              {customCount > 0
                ? `${customCount} personalizado${customCount === 1 ? '' : 's'} · el resto usa el texto por defecto.`
                : 'Todos usan el texto por defecto.'}
            </p>

            <div className="flex flex-col gap-8">
              {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
                const kindsInCat = grouped.get(cat) ?? [];
                return (
                  <section key={cat} className="flex flex-col gap-3">
                    <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-semibold">
                      {cat}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {kindsInCat.map((kind) => {
                        const meta = getKindMeta(kind);
                        const hasOverride = overrideByKind.has(kind);
                        return (
                          <div
                            key={kind}
                            className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-3 hover:border-[var(--color-border-strong)] transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex flex-col gap-1 min-w-0">
                                <span className="text-[14px] font-semibold text-[var(--color-fg)] leading-tight">
                                  {meta.label}
                                </span>
                                <span className="text-[12px] text-[var(--color-fg-muted)] leading-snug">
                                  {meta.whenSent}
                                </span>
                              </div>
                              {hasOverride ? (
                                <Badge variant="success">Personalizado</Badge>
                              ) : (
                                <Badge variant="neutral">Por defecto</Badge>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-auto">
                              <span className="text-[11px] text-[var(--color-fg-subtle)]">
                                {meta.audience === 'jugador'
                                  ? 'Le llega al jugador'
                                  : 'Te llega a vos (admin)'}
                              </span>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setSelectedKind(kind)}
                              >
                                <Pencil className="size-3.5" />
                                Personalizar
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
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
