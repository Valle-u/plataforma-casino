/**
 * RequestFiltersBar — barra de filtros compartida para las colas de
 * Depósitos y Retiros. Los mismos valores alimentan la lista en pantalla
 * Y el export CSV, así "lo que ves es lo que bajás".
 *
 * Filtros: rango de fechas (desde/hasta), método de pago, con/sin
 * transferencia matcheada, y búsqueda por usuario (username, nombre o ID).
 * Plegable para no amontonar la vista.
 */

'use client';

import { Search, SlidersHorizontal, X } from 'lucide-react';
import { CollapsibleCard } from '@/components/admin/collapsible-card';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { arDatetimeLocalToIso } from '@/lib/format-date';

export interface RequestFilters {
  /** datetime-local value (local). Se convierte a ISO al consultar. */
  fromDate: string;
  toDate: string;
  methodId: string;
  matched: '' | 'yes' | 'no';
  userSearch: string;
}

export const EMPTY_REQUEST_FILTERS: RequestFilters = {
  fromDate: '',
  toDate: '',
  methodId: '',
  matched: '',
  userSearch: '',
};

export function requestFiltersActive(f: RequestFilters): boolean {
  return !!(f.fromDate || f.toDate || f.methodId || f.matched || f.userSearch);
}

/** Params (strings) que entienden el list endpoint y el export. */
export function requestFiltersToParams(
  f: RequestFilters,
): Record<string, string | undefined> {
  return {
    fromDate: arDatetimeLocalToIso(f.fromDate),
    toDate: arDatetimeLocalToIso(f.toDate),
    methodId: f.methodId || undefined,
    matched: f.matched || undefined,
    userSearch: f.userSearch.trim() || undefined,
  };
}

export function RequestFiltersBar({
  filters,
  onChange,
  methods,
  matchedLabel = 'transferencia',
}: {
  filters: RequestFilters;
  onChange: (patch: Partial<RequestFilters>) => void;
  methods: { id: string; code: string; name: string }[];
  matchedLabel?: string;
}) {
  const active = requestFiltersActive(filters);
  return (
    <CollapsibleCard
      title="Filtros"
      icon={<SlidersHorizontal className="size-4" />}
      defaultOpen={false}
      right={
        active ? (
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-accent-text)]">
            activos
          </span>
        ) : undefined
      }
      bodyClassName="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      <FormField id="rf-from" label="Desde">
        <Input
          id="rf-from"
          type="datetime-local"
          value={filters.fromDate}
          onChange={(e) => onChange({ fromDate: e.target.value })}
        />
      </FormField>

      <FormField id="rf-to" label="Hasta">
        <Input
          id="rf-to"
          type="datetime-local"
          value={filters.toDate}
          onChange={(e) => onChange({ toDate: e.target.value })}
        />
      </FormField>

      <FormField id="rf-method" label="Método de pago">
        <Select
          id="rf-method"
          value={filters.methodId}
          onChange={(e) => onChange({ methodId: e.target.value })}
        >
          <option value="">Todos</option>
          {methods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField id="rf-matched" label="Transferencia">
        <Select
          id="rf-matched"
          value={filters.matched}
          onChange={(e) =>
            onChange({ matched: e.target.value as RequestFilters['matched'] })
          }
        >
          <option value="">Todas</option>
          <option value="yes">Con {matchedLabel}</option>
          <option value="no">Sin {matchedLabel}</option>
        </Select>
      </FormField>

      <FormField id="rf-user" label="Buscar usuario" hint="Usuario, nombre o ID">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
          <Input
            id="rf-user"
            type="text"
            value={filters.userSearch}
            onChange={(e) => onChange({ userSearch: e.target.value })}
            placeholder="juanpe"
            className="pl-9"
          />
        </div>
      </FormField>

      <div className="flex items-end">
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(EMPTY_REQUEST_FILTERS)}
          >
            <X className="size-3.5" />
            Limpiar filtros
          </Button>
        )}
      </div>
    </CollapsibleCard>
  );
}
