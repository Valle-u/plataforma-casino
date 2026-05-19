/**
 * StreakConfigEditor — editor visual del config de login_streak.
 *
 * Controlled component: recibe `value: StreakConfig` y emite el config
 * completo en `onChange`.
 *
 * Estructura del config:
 *   - prizes[]: array ordenado de prizes (día 1 = índice 0).
 *   - forgivenessDays: cuántos días puede saltearse antes del reset (0-7).
 *   - onMax: qué hace cuando streak > prizes.length ('hold' | 'cycle' | 'reset').
 *   - autoClaimOnLogin: si true, el login automático reclama el premio del día.
 *
 * Reusa `PrizeEditor` del wheel-config-editor para el prize de cada día.
 */

'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { PrizeEditor, type WheelPrize } from './wheel-config-editor';

export type StreakOnMax = 'hold' | 'cycle' | 'reset';

export interface StreakPrize extends WheelPrize {}

export interface StreakConfig {
  prizes: StreakPrize[];
  forgivenessDays?: number;
  onMax?: StreakOnMax;
  autoClaimOnLogin?: boolean;
}

const ON_MAX_OPTIONS: { value: StreakOnMax; label: string; hint: string }[] = [
  {
    value: 'hold',
    label: 'Hold',
    hint: 'Si supera el último día, sigue dando el último premio.',
  },
  {
    value: 'cycle',
    label: 'Cycle',
    hint: 'Cuando llega al final, vuelve a día 1.',
  },
  {
    value: 'reset',
    label: 'Reset',
    hint: 'Cuando llega al final, resetea a streak=1.',
  },
];

interface StreakConfigEditorProps {
  value: StreakConfig;
  onChange: (next: StreakConfig) => void;
}

export function StreakConfigEditor({
  value,
  onChange,
}: StreakConfigEditorProps) {
  const prizes = value.prizes ?? [];

  function updatePrize(index: number, patch: Partial<StreakPrize>): void {
    const next = prizes.map((p, i) => (i === index ? { ...p, ...patch } : p));
    onChange({ ...value, prizes: next });
  }

  function addPrize(): void {
    onChange({
      ...value,
      prizes: [...prizes, { kind: 'chips', amount: 100 }],
    });
  }

  function removePrize(index: number): void {
    onChange({
      ...value,
      prizes: prizes.filter((_, i) => i !== index),
    });
  }

  function move(from: number, to: number): void {
    if (to < 0 || to >= prizes.length) return;
    const next = prizes.slice();
    const [picked] = next.splice(from, 1);
    next.splice(to, 0, picked!);
    onChange({ ...value, prizes: next });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Settings */}
      <div className="flex flex-col gap-3 p-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
          Reglas del streak
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField
            id="streak-forgiveness"
            label="Días de gracia"
            hint="0 = romper streak si te salteás 1 día."
          >
            <Input
              id="streak-forgiveness"
              type="number"
              inputMode="numeric"
              value={value.forgivenessDays ?? 0}
              onChange={(e) =>
                onChange({
                  ...value,
                  forgivenessDays: Number(e.target.value) || 0,
                })
              }
              min={0}
              max={7}
              className="font-mono"
            />
          </FormField>
          <FormField id="streak-onmax" label="Al pasar el máximo" hint={
            ON_MAX_OPTIONS.find((o) => o.value === (value.onMax ?? 'hold'))?.hint
          }>
            <Select
              id="streak-onmax"
              value={value.onMax ?? 'hold'}
              onChange={(e) =>
                onChange({ ...value, onMax: e.target.value as StreakOnMax })
              }
            >
              {ON_MAX_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id="streak-autoclaim"
            label="Auto-claim en login"
            hint="Si está activo, el login reclama el premio del día."
          >
            <label className="flex items-center gap-2 h-10 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={value.autoClaimOnLogin ?? false}
                onChange={(e) =>
                  onChange({ ...value, autoClaimOnLogin: e.target.checked })
                }
                className="size-4 accent-[var(--color-accent)] cursor-pointer"
              />
              <span className="text-[12px] text-[var(--color-fg)]">
                {value.autoClaimOnLogin ? 'Activado' : 'Manual'}
              </span>
            </label>
          </FormField>
        </div>
      </div>

      {/* Header de prizes */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
            Premios por día
          </span>
          <span className="text-[11px] text-[var(--color-fg-muted)]">
            {prizes.length} día{prizes.length === 1 ? '' : 's'} configurados.
            El orden = día 1 → día N.
          </span>
        </div>
        <Button variant="secondary" size="sm" type="button" onClick={addPrize}>
          <Plus className="size-3.5" />
          Agregar día
        </Button>
      </div>

      {/* Lista */}
      {prizes.length === 0 ? (
        <div className="p-4 border border-dashed border-[var(--color-border-strong)] text-center text-[12px] text-[var(--color-fg-subtle)]">
          Sin premios. Agregá al menos uno para que el streak sea útil.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {prizes.map((prize, i) => (
            <li
              key={i}
              className="flex flex-col gap-3 p-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--color-fg)]">
                  Día {i + 1}
                </span>
                <div className="flex items-center gap-1">
                  <ReorderBtn
                    direction="up"
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  />
                  <ReorderBtn
                    direction="down"
                    disabled={i === prizes.length - 1}
                    onClick={() => move(i, i + 1)}
                  />
                  <button
                    type="button"
                    onClick={() => removePrize(i)}
                    aria-label="Eliminar día"
                    className={cn(
                      'size-7 flex items-center justify-center',
                      'border border-[var(--color-border)]',
                      'text-[var(--color-fg-subtle)]',
                      'hover:border-[var(--color-accent)] hover:text-[var(--color-accent-text)]',
                      'transition-colors',
                    )}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>

              <FormField id={`streak-day-${i}-label`} label="Label (opcional)">
                <Input
                  id={`streak-day-${i}-label`}
                  type="text"
                  value={prize.label ?? ''}
                  onChange={(e) => updatePrize(i, { label: e.target.value })}
                  placeholder="100 chips"
                />
              </FormField>

              <PrizeEditor
                prize={prize}
                onChange={(patch) => updatePrize(i, patch)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReorderBtn({
  direction,
  disabled,
  onClick,
}: {
  direction: 'up' | 'down';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === 'up' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'up' ? 'Mover arriba' : 'Mover abajo'}
      className={cn(
        'size-7 flex items-center justify-center',
        'border border-[var(--color-border)]',
        'text-[var(--color-fg-subtle)]',
        'hover:border-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
        'disabled:opacity-30 disabled:pointer-events-none',
        'transition-colors',
      )}
    >
      <Icon className="size-3" />
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helper para parsear el config jsonb a StreakConfig tipado.
// ──────────────────────────────────────────────────────────────────────

export function parseStreakConfig(raw: unknown): StreakConfig {
  if (!raw || typeof raw !== 'object') {
    return { prizes: [] };
  }
  const r = raw as Record<string, unknown>;
  const prizes = Array.isArray(r.prizes)
    ? r.prizes.map(normalizePrize)
    : [];
  return {
    prizes,
    forgivenessDays:
      typeof r.forgivenessDays === 'number' ? r.forgivenessDays : undefined,
    onMax:
      r.onMax === 'hold' || r.onMax === 'cycle' || r.onMax === 'reset'
        ? r.onMax
        : undefined,
    autoClaimOnLogin:
      typeof r.autoClaimOnLogin === 'boolean'
        ? r.autoClaimOnLogin
        : undefined,
  };
}

function normalizePrize(raw: unknown): StreakPrize {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    kind:
      r.kind === 'bonus' ||
      r.kind === 'free_spins' ||
      r.kind === 'try_again' ||
      r.kind === 'chips'
        ? r.kind
        : 'chips',
    amount: typeof r.amount === 'number' ? r.amount : undefined,
    bonusDefinitionId:
      typeof r.bonusDefinitionId === 'string'
        ? r.bonusDefinitionId
        : undefined,
    description:
      typeof r.description === 'string' ? r.description : undefined,
    label: typeof r.label === 'string' ? r.label : undefined,
  };
}
