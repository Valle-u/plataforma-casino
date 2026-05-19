/**
 * WheelConfigEditor — editor visual del config de daily_wheel.
 *
 * Controlled component: recibe `value: WheelConfig` y emite el config
 * completo en `onChange`. NO mantiene estado interno — el caller (form)
 * es la source of truth. Esto permite integrar con react-hook-form via
 * watch/setValue sin reimplementar dirty tracking.
 *
 * Validación visual (no bloqueante):
 *   - Suma de probabilities ≈ 1.0 (acepta 0.99-1.01 por flotantes) o
 *     ≈ 100 (98-102) — el backend acepta ambos formatos.
 *   - Al menos 1 segmento.
 *   - Por segmento: probability > 0, prize.kind requerido.
 *
 * La validación dura la hace el backend al PATCH (WHEEL_CONFIG_INVALID
 * → 409). Acá solo damos feedback visual para que el admin entienda
 * antes de guardar.
 */

'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';

export type WheelPrizeKind = 'chips' | 'try_again' | 'bonus' | 'free_spins';

export interface WheelPrize {
  kind: WheelPrizeKind;
  amount?: number;
  bonusDefinitionId?: string;
  description?: string;
  label?: string;
}

export interface WheelSegment {
  id: string;
  label?: string;
  probability: number;
  prize: WheelPrize;
}

export interface WheelConfig {
  segments: WheelSegment[];
}

const PRIZE_KINDS: { value: WheelPrizeKind; label: string }[] = [
  { value: 'chips', label: 'Chips' },
  { value: 'bonus', label: 'Bono' },
  { value: 'free_spins', label: 'Free spins' },
  { value: 'try_again', label: 'Probá de nuevo' },
];

interface WheelConfigEditorProps {
  value: WheelConfig;
  onChange: (next: WheelConfig) => void;
}

export function WheelConfigEditor({ value, onChange }: WheelConfigEditorProps) {
  const segments = value.segments ?? [];

  const probabilitySum = useMemo(
    () => segments.reduce((acc, s) => acc + (Number(s.probability) || 0), 0),
    [segments],
  );
  // El backend acepta probabilities en escala 0-1 O 0-100. Detectamos
  // cuál usa el admin por el orden de magnitud de la suma.
  const scale: 'percent' | 'fraction' =
    probabilitySum > 5 ? 'percent' : 'fraction';
  const targetSum = scale === 'percent' ? 100 : 1;
  const tolerance = scale === 'percent' ? 1 : 0.01;
  const isValid =
    segments.length > 0 &&
    Math.abs(probabilitySum - targetSum) <= tolerance &&
    segments.every((s) => s.probability > 0 && !!s.prize?.kind);

  function updateSegment(index: number, patch: Partial<WheelSegment>): void {
    const next = segments.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange({ ...value, segments: next });
  }

  function updatePrize(index: number, patch: Partial<WheelPrize>): void {
    const cur = segments[index]!;
    updateSegment(index, { prize: { ...cur.prize, ...patch } });
  }

  function addSegment(): void {
    const id = `seg_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 5)}`;
    const newSeg: WheelSegment = {
      id,
      label: '',
      probability: scale === 'percent' ? 10 : 0.1,
      prize: { kind: 'chips', amount: 100 },
    };
    onChange({ ...value, segments: [...segments, newSeg] });
  }

  function removeSegment(index: number): void {
    onChange({
      ...value,
      segments: segments.filter((_, i) => i !== index),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header + add */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
            Segmentos de la rueda
          </span>
          <span className="text-[11px] text-[var(--color-fg-muted)]">
            {segments.length} segmento{segments.length === 1 ? '' : 's'} ·
            escala {scale === 'percent' ? '0-100' : '0-1'}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={addSegment}
        >
          <Plus className="size-3.5" />
          Agregar
        </Button>
      </div>

      {/* Sum indicator */}
      <div
        className={cn(
          'flex items-center justify-between gap-3 px-3 py-2 border text-[12px]',
          isValid
            ? 'border-[var(--color-success-border,var(--color-border))] bg-[var(--color-success-bg,var(--color-bg-elevated))]'
            : 'border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)]',
        )}
      >
        <span className="text-[var(--color-fg)]">
          Suma de probabilidades: <span className="font-mono">{probabilitySum.toFixed(scale === 'percent' ? 1 : 3)}</span>
        </span>
        <span className="font-mono text-[var(--color-fg-muted)]">
          esperado ≈ {targetSum}
        </span>
      </div>

      {/* Lista */}
      {segments.length === 0 ? (
        <div className="p-4 border border-dashed border-[var(--color-border-strong)] text-center text-[12px] text-[var(--color-fg-subtle)]">
          Sin segmentos. Agregá al menos uno.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {segments.map((seg, i) => (
            <SegmentEditor
              key={seg.id || i}
              segment={seg}
              scale={scale}
              onUpdate={(patch) => updateSegment(i, patch)}
              onUpdatePrize={(patch) => updatePrize(i, patch)}
              onRemove={() => removeSegment(i)}
              canRemove={segments.length > 1}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SegmentEditor — una fila de segmento (label + prob + prize).
// ──────────────────────────────────────────────────────────────────────

function SegmentEditor({
  segment,
  scale,
  onUpdate,
  onUpdatePrize,
  onRemove,
  canRemove,
}: {
  segment: WheelSegment;
  scale: 'percent' | 'fraction';
  onUpdate: (patch: Partial<WheelSegment>) => void;
  onUpdatePrize: (patch: Partial<WheelPrize>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <li className="flex flex-col gap-3 p-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <div className="flex items-start gap-3">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-3">
          <FormField id={`seg-${segment.id}-label`} label="Label (visible al player)">
            <Input
              id={`seg-${segment.id}-label`}
              type="text"
              value={segment.label ?? ''}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="100 chips"
            />
          </FormField>
          <FormField
            id={`seg-${segment.id}-prob`}
            label={`Prob (${scale === 'percent' ? '%' : '0-1'})`}
          >
            <Input
              id={`seg-${segment.id}-prob`}
              type="number"
              inputMode="decimal"
              value={Number.isFinite(segment.probability) ? segment.probability : 0}
              onChange={(e) =>
                onUpdate({ probability: Number(e.target.value) })
              }
              step={scale === 'percent' ? 1 : 0.01}
              min={0}
              max={scale === 'percent' ? 100 : 1}
              className="font-mono"
            />
          </FormField>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Eliminar segmento"
          className={cn(
            'mt-6 size-8 flex items-center justify-center',
            'border border-[var(--color-border)]',
            'text-[var(--color-fg-subtle)]',
            'hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]',
            'disabled:opacity-30 disabled:pointer-events-none',
            'transition-colors',
          )}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <PrizeEditor prize={segment.prize} onChange={onUpdatePrize} />
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// PrizeEditor — exportado para reuso desde streak editor también.
// ──────────────────────────────────────────────────────────────────────

export function PrizeEditor({
  prize,
  onChange,
}: {
  prize: WheelPrize;
  onChange: (patch: Partial<WheelPrize>) => void;
}) {
  const kind = prize?.kind ?? 'chips';
  const needsAmount = kind === 'chips' || kind === 'free_spins';
  const needsBonusId = kind === 'bonus';
  return (
    <div className="flex flex-col gap-2 p-3 bg-[var(--color-bg-subtle)] border border-[var(--color-border)]">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
        Premio
      </span>
      <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
        <FormField id="prize-kind" label="Tipo">
          <Select
            id="prize-kind"
            value={kind}
            onChange={(e) =>
              onChange({ kind: e.target.value as WheelPrizeKind })
            }
          >
            {PRIZE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </FormField>
        {needsAmount && (
          <FormField id="prize-amount" label="Cantidad">
            <Input
              id="prize-amount"
              type="number"
              inputMode="numeric"
              value={prize.amount ?? 0}
              onChange={(e) => onChange({ amount: Number(e.target.value) })}
              min={0}
              className="font-mono"
            />
          </FormField>
        )}
        {needsBonusId && (
          <FormField
            id="prize-bonus-id"
            label="Bonus definition ID"
          >
            <Input
              id="prize-bonus-id"
              type="text"
              value={prize.bonusDefinitionId ?? ''}
              onChange={(e) =>
                onChange({ bonusDefinitionId: e.target.value })
              }
              placeholder="uuid de bonus_definition"
              className="font-mono text-[11px]"
            />
          </FormField>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers públicos para parsear el config del jsonb.
// ──────────────────────────────────────────────────────────────────────

/**
 * Convierte el `config` jsonb crudo del backend a `WheelConfig` tipado.
 * Si el config no tiene `segments` o no es array, devuelve `{ segments: [] }`.
 */
export function parseWheelConfig(raw: unknown): WheelConfig {
  if (raw && typeof raw === 'object' && 'segments' in raw) {
    const segs = (raw as { segments?: unknown }).segments;
    if (Array.isArray(segs)) {
      return {
        segments: segs.map((s, i) => normalizeSegment(s, i)),
      };
    }
  }
  return { segments: [] };
}

function normalizeSegment(raw: unknown, index: number): WheelSegment {
  const r = (raw ?? {}) as Record<string, unknown>;
  const prize = (r.prize ?? {}) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : `seg_${index}`,
    label: typeof r.label === 'string' ? r.label : undefined,
    probability: typeof r.probability === 'number' ? r.probability : 0,
    prize: {
      kind:
        typeof prize.kind === 'string'
          ? (prize.kind as WheelPrizeKind)
          : 'chips',
      amount: typeof prize.amount === 'number' ? prize.amount : undefined,
      bonusDefinitionId:
        typeof prize.bonusDefinitionId === 'string'
          ? prize.bonusDefinitionId
          : undefined,
      description:
        typeof prize.description === 'string'
          ? prize.description
          : undefined,
      label: typeof prize.label === 'string' ? prize.label : undefined,
    },
  };
}
