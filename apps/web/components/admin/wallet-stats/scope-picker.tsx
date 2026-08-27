/**
 * ScopePicker — selector de ÁMBITO de red, compartido por "Netwin por red" y
 * por la bitácora "General" de Estadísticas de pago.
 *
 * Ámbitos: toda la plataforma / red dependiente / red central / un socio
 * independiente (dropdown) / un panel puntual (buscador de usuario).
 */

'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { UserSelect } from '@/components/ui/user-select';
import { cn } from '@/lib/cn';
import { type TenantUserRow } from '@/lib/hooks/use-users';
import {
  useWalletStatsScopes,
  type ScopeKind,
} from '@/lib/hooks/use-wallet-stats';

export const SCOPE_OPTIONS: { id: ScopeKind; label: string }[] = [
  { id: 'platform', label: 'Toda la plataforma' },
  { id: 'dependent', label: 'Red dependiente' },
  { id: 'central', label: 'Red central' },
  { id: 'independent', label: 'Socio independiente' },
  { id: 'user', label: 'Panel puntual' },
];

/** ¿El ámbito está listo para consultar? (indep/panel necesitan una selección). */
export function isScopeReady(
  scopeKind: ScopeKind,
  indepId: string,
  panelUser: TenantUserRow | null,
): boolean {
  return (
    (scopeKind !== 'independent' || !!indepId) &&
    (scopeKind !== 'user' || !!panelUser)
  );
}

/** Deriva { scope, scopeId } para pasar a los filtros / endpoints. */
export function scopeToParams(
  scopeKind: ScopeKind,
  indepId: string,
  panelUser: TenantUserRow | null,
): { scope: ScopeKind; scopeId?: string } {
  return {
    scope: scopeKind,
    scopeId:
      scopeKind === 'independent'
        ? indepId
        : scopeKind === 'user'
          ? (panelUser?.id ?? undefined)
          : undefined,
  };
}

/** Etiqueta legible del ámbito elegido. */
export function scopeLabelOf(
  scopeKind: ScopeKind,
  indepId: string,
  panelUser: TenantUserRow | null,
): string | undefined {
  if (scopeKind === 'independent') {
    return indepId ? undefined : 'Elegí un socio independiente';
  }
  if (scopeKind === 'user') {
    return panelUser
      ? `${panelUser.displayName || panelUser.username} + su red`
      : 'Elegí un panel';
  }
  return SCOPE_OPTIONS.find((s) => s.id === scopeKind)?.label;
}

export function ScopePicker({
  label = 'Ámbito',
  showHelp = true,
  scopeKind,
  onScopeKind,
  indepId,
  onIndepId,
  panelUser,
  onPanelUser,
}: {
  label?: string;
  showHelp?: boolean;
  scopeKind: ScopeKind;
  onScopeKind: (k: ScopeKind) => void;
  indepId: string;
  onIndepId: (id: string) => void;
  panelUser: TenantUserRow | null;
  onPanelUser: (u: TenantUserRow | null) => void;
}) {
  const scopes = useWalletStatsScopes();

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {SCOPE_OPTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onScopeKind(s.id)}
            className={cn(
              'px-3 h-11 lg:h-9 text-[11px] font-medium rounded-[var(--radius-sm)] border transition-colors',
              scopeKind === s.id
                ? 'bg-[var(--color-bg-subtle)] text-[var(--color-fg)] border-[var(--color-border-strong)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:text-[var(--color-fg)]',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {showHelp && (
        <p className="text-[11px] text-[var(--color-fg-subtle)] leading-snug">
          <strong>Red dependiente</strong>: tu red central + los socios
          dependientes y sus redes.{' '}
          <strong>Red central</strong>: solo lo tuyo directo, sin los socios
          dependientes.{' '}
          <strong>Socio independiente</strong>: un “casino aparte” que banca su
          propia red.
        </p>
      )}

      {/* Sub-selector según el ámbito */}
      {scopeKind === 'independent' && (
        <div className="max-w-sm mt-1">
          {scopes.isLoading ? (
            <Skeleton className="h-9" />
          ) : (
            <select
              value={indepId}
              onChange={(e) => onIndepId(e.target.value)}
              className="h-9 w-full px-2 text-[13px] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[var(--color-fg)]"
            >
              <option value="">— Elegí un socio independiente —</option>
              {(scopes.data?.independientes ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName || s.username} (@{s.username})
                </option>
              ))}
            </select>
          )}
          {!scopes.isLoading &&
            (scopes.data?.independientes.length ?? 0) === 0 && (
              <p className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
                No hay socios independientes en este tenant.
              </p>
            )}
        </div>
      )}
      {scopeKind === 'user' && (
        <div className="max-w-md mt-1">
          <UserSelect
            value={panelUser}
            onSelect={onPanelUser}
            includeSelf
            placeholder="Buscar cajero / socio / distribuidor…"
          />
        </div>
      )}
    </div>
  );
}
