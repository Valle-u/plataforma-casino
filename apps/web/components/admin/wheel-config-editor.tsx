/**
 * WheelConfigEditor — editor visual del config de daily_wheel.
 *
 * Premios soportados por el backend (docs/27 §5.1):
 *   - `bonus`: acredita un bono al jugador (requiere planilla de bono).
 *   - `try_again`: sin premio. Es donde cae la rueda cuando se agota el día.
 *
 * PROHIBIDOS en backend (tiran error al guardar):
 *   - `chips`: la ruleta no entrega fichas retirables.
 *   - `free_spins`: no implementado.
 *
 * Controlled: `value: WheelConfig` → `onChange(next)`.
 * El caller (form) es la source of truth.
 */

'use client';

import { Plus, Trash2, Shuffle, RotateCcw } from 'lucide-react';
import { useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  canonicalBonusAmount,
  type BonusDefinition,
} from '@/lib/hooks/use-bonuses';

/* ── Types (exportados para reuso) ─────────────────────────────────── */

export type WheelPrizeKind = 'bonus' | 'try_again' | 'chips' | 'free_spins';

export interface WheelPrize {
  kind: WheelPrizeKind;
  amount?: number;
  /** Para kind='bonus': id de la bonus_definition a otorgar. */
  definitionId?: string;
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

/* ── Presets ───────────────────────────────────────────────────────── */

const SEGMENT_COLORS = [
  '#eab308', // gold
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#ec4899', // magenta
  '#22c55e', // green
  '#f97316', // orange
];

interface WheelPreset {
  label: string;
  description: string;
  segments: Omit<WheelSegment, 'id'>[];
}

const PRESETS: WheelPreset[] = [
  {
    label: 'Simple',
    description: '2 gajos: bono o sin premio',
    segments: [
      { probability: 50, label: 'Bono', prize: { kind: 'bonus', amount: 100 } },
      { probability: 50, label: 'Sin premio', prize: { kind: 'try_again' } },
    ],
  },
  {
    label: 'Estándar',
    description: '4 gajos con distintos montos',
    segments: [
      { probability: 30, label: 'Bono', prize: { kind: 'bonus', amount: 50 } },
      { probability: 30, label: 'Bono', prize: { kind: 'bonus', amount: 100 } },
      { probability: 25, label: 'Bono', prize: { kind: 'bonus', amount: 200 } },
      { probability: 15, label: 'Sin premio', prize: { kind: 'try_again' } },
    ],
  },
  {
    label: 'Generosa',
    description: '4 gajos, montos más altos',
    segments: [
      { probability: 40, label: 'Bono', prize: { kind: 'bonus', amount: 100 } },
      { probability: 30, label: 'Bono', prize: { kind: 'bonus', amount: 200 } },
      { probability: 20, label: 'Bono', prize: { kind: 'bonus', amount: 500 } },
      { probability: 10, label: 'Sin premio', prize: { kind: 'try_again' } },
    ],
  },
];

/* ── Helpers ───────────────────────────────────────────────────────── */

function makeId(): string {
  return `seg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function segmentColor(i: number): string {
  return SEGMENT_COLORS[i % SEGMENT_COLORS.length] ?? '#888';
}

/** Label legible de un bonus para el dropdown. */
function bonusLabel(def: BonusDefinition): string {
  const amount = canonicalBonusAmount(def);
  const suffix = amount ? ` — ${amount} fichas` : '';
  return `${def.name}${suffix}`;
}

/* ── Main component ────────────────────────────────────────────────── */

interface WheelConfigEditorProps {
  value: WheelConfig;
  onChange: (next: WheelConfig) => void;
  /** Planillas de bono disponibles para elegir como premio. */
  bonusDefinitions?: BonusDefinition[];
}

export function WheelConfigEditor({
  value,
  onChange,
  bonusDefinitions = [],
}: WheelConfigEditorProps) {
  const segments = value.segments ?? [];

  const probabilitySum = useMemo(
    () => segments.reduce((acc, s) => acc + (Number(s.probability) || 0), 0),
    [segments],
  );

  const isValid =
    segments.length > 0 &&
    Math.abs(probabilitySum - 100) <= 1 &&
    segments.every((s) => s.probability > 0 && !!s.prize?.kind);

  const sumError = Math.abs(probabilitySum - 100) > 1;

  /* ── Actions ───────────────────────────────────────────────────── */

  const applyPreset = useCallback(
    (preset: WheelPreset) => {
      const segs: WheelSegment[] = preset.segments.map((s) => ({
        ...s,
        id: makeId(),
      }));
      onChange({ segments: segs });
    },
    [onChange],
  );

  const autoBalance = useCallback(() => {
    if (segments.length === 0) return;
    const each = Math.floor(100 / segments.length);
    const remainder = 100 - each * segments.length;
    const next = segments.map((s, i) => ({
      ...s,
      probability: i < remainder ? each + 1 : each,
    }));
    onChange({ segments: next });
  }, [segments, onChange]);

  const autoFixSum = useCallback(() => {
    if (segments.length === 0) return;
    const diff = 100 - probabilitySum;
    let maxIdx = 0;
    let maxVal = 0;
    segments.forEach((s, i) => {
      if (s.probability > maxVal) {
        maxVal = s.probability;
        maxIdx = i;
      }
    });
    const next = segments.map((s, i) =>
      i === maxIdx ? { ...s, probability: Math.max(0, s.probability + diff) } : s,
    );
    onChange({ segments: next });
  }, [segments, probabilitySum, onChange]);

  const updateSegment = useCallback(
    (index: number, patch: Partial<WheelSegment>) => {
      const next = segments.map((s, i) => (i === index ? { ...s, ...patch } : s));
      onChange({ segments: next });
    },
    [segments, onChange],
  );

  const updatePrize = useCallback(
    (index: number, patch: Partial<WheelPrize>) => {
      const cur = segments[index]!;
      updateSegment(index, { prize: { ...cur.prize, ...patch } });
    },
    [segments, updateSegment],
  );

  const addSegment = useCallback(() => {
    const remaining = Math.max(0, 100 - probabilitySum);
    const newSeg: WheelSegment = {
      id: makeId(),
      label: '',
      probability: Math.min(remaining, 10),
      prize: { kind: 'bonus', amount: 100 },
    };
    onChange({ segments: [...segments, newSeg] });
  }, [segments, probabilitySum, onChange]);

  const removeSegment = useCallback(
    (index: number) => {
      onChange({ segments: segments.filter((_, i) => i !== index) });
    },
    [segments, onChange],
  );

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-4">
      {/* Presets */}
      {segments.length === 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-medium text-[var(--color-fg)]">
            Elegí una plantilla para arrancar
          </span>
          <div className="flex gap-2 flex-wrap">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={cn(
                  'flex flex-col gap-0.5 px-3 py-2 rounded-[var(--radius)]',
                  'border border-[var(--color-border)]',
                  'bg-[var(--color-bg-elevated)]',
                  'hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]',
                  'transition-colors text-left',
                )}
              >
                <span className="text-[12px] font-medium text-[var(--color-fg)]">
                  {p.label}
                </span>
                <span className="text-[10px] text-[var(--color-fg-muted)]">
                  {p.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Header + actions */}
      {segments.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-[var(--color-fg)]">
              Gajos de la rueda
            </span>
            <span className="text-[10px] text-[var(--color-fg-muted)]">
              {segments.length} gajo{segments.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={autoBalance}
              title="Distribuir equitativamente"
            >
              <Shuffle className="size-3.5" />
              <span className="hidden sm:inline">Repartir</span>
            </Button>
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
        </div>
      )}

      {/* Sum indicator + bar */}
      {segments.length > 0 && (
        <div
          className={cn(
            'flex flex-col gap-2 px-3 py-2 border text-[12px]',
            isValid
              ? 'border-[var(--color-success-border,var(--color-border))] bg-[var(--color-success-bg,var(--color-bg-elevated))]'
              : 'border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)]',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[var(--color-fg)]">
              Probabilidades:{' '}
              <span className="font-mono font-medium">
                {probabilitySum.toFixed(1)}%
              </span>
            </span>
            {sumError ? (
              <button
                type="button"
                onClick={autoFixSum}
                className="text-[11px] text-[var(--color-accent-text)] hover:underline cursor-pointer"
              >
                Auto-ajustar
              </button>
            ) : (
              <span className="text-[10px] text-[var(--color-fg-muted)]">
                ✓ suma 100%
              </span>
            )}
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-[var(--color-bg-subtle)]">
            {segments.map((seg, i) => {
              const pct = probabilitySum > 0 ? (seg.probability / probabilitySum) * 100 : 0;
              return (
                <div
                  key={seg.id || i}
                  style={{
                    width: `${pct}%`,
                    backgroundColor: segmentColor(i),
                  }}
                  className="transition-all duration-200"
                  title={`${seg.label || `Gajo ${i + 1}`}: ${seg.probability}%`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Mini preview */}
      {segments.length > 0 && (
        <WheelPreview segments={segments} />
      )}

      {/* Segment list */}
      {segments.length === 0 ? (
        <div className="p-6 border border-dashed border-[var(--color-border-strong)] text-center text-[12px] text-[var(--color-fg-subtle)]">
          Elegí una plantilla de arriba o agregá gajos manualmente.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {segments.map((seg, i) => (
            <SegmentEditor
              key={seg.id || i}
              segment={seg}
              color={segmentColor(i)}
              bonusDefinitions={bonusDefinitions}
              onUpdate={(patch) => updateSegment(i, patch)}
              onUpdatePrize={(patch) => updatePrize(i, patch)}
              onRemove={() => removeSegment(i)}
              canRemove={segments.length > 1}
            />
          ))}
        </ul>
      )}

      {/* Reset button when segments exist */}
      {segments.length > 0 && (
        <button
          type="button"
          onClick={() => onChange({ segments: [] })}
          className="self-start text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-accent-text)] transition-colors"
        >
          <RotateCcw className="size-3 inline mr-1" />
          Empezar de nuevo
        </button>
      )}
    </div>
  );
}

/* ── SegmentEditor ─────────────────────────────────────────────────── */

function SegmentEditor({
  segment,
  color,
  bonusDefinitions,
  onUpdate,
  onUpdatePrize,
  onRemove,
  canRemove,
}: {
  segment: WheelSegment;
  color: string;
  bonusDefinitions: BonusDefinition[];
  onUpdate: (patch: Partial<WheelSegment>) => void;
  onUpdatePrize: (patch: Partial<WheelPrize>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const kind = segment.prize?.kind ?? 'bonus';
  const isBonus = kind === 'bonus';

  // Buscar el bonus seleccionado para mostrar info
  const selectedBonus = useMemo(
    () =>
      isBonus && segment.prize.definitionId
        ? bonusDefinitions.find((d) => d.id === segment.prize.definitionId)
        : undefined,
    [isBonus, segment.prize.definitionId, bonusDefinitions],
  );

  const handleBonusChange = useCallback(
    (defId: string) => {
      const def = bonusDefinitions.find((d) => d.id === defId);
      if (def) {
        const amount = canonicalBonusAmount(def);
        onUpdatePrize({
          definitionId: def.id,
          amount: amount ? Number(amount) : undefined,
          label: def.name,
        });
      } else {
        onUpdatePrize({ definitionId: undefined });
      }
    },
    [bonusDefinitions, onUpdatePrize],
  );

  return (
    <li className="flex flex-col gap-3 p-3 rounded-[var(--radius)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      {/* Color dot + label + probability */}
      <div className="flex items-start gap-3">
        <div
          className="mt-2.5 size-3 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_100px] gap-3">
          <FormField id={`seg-label-${segment.id}`} label="Nombre del gajo">
            <Input
              id={`seg-label-${segment.id}`}
              type="text"
              value={segment.label ?? ''}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="Ej: Bono 100"
            />
          </FormField>
          <FormField id={`seg-prob-${segment.id}`} label="Probabilidad %">
            <Input
              id={`seg-prob-${segment.id}`}
              type="number"
              inputMode="decimal"
              value={Number.isFinite(segment.probability) ? segment.probability : 0}
              onChange={(e) =>
                onUpdate({ probability: Number(e.target.value) })
              }
              step={1}
              min={0}
              max={100}
              className="font-mono"
            />
          </FormField>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Eliminar gajo"
          className={cn(
            'mt-2.5 size-8 flex items-center justify-center',
            'border border-[var(--color-border)]',
            'text-[var(--color-fg-subtle)]',
            'hover:border-[var(--color-accent)] hover:text-[var(--color-accent-text)]',
            'disabled:opacity-30 disabled:pointer-events-none',
            'transition-colors',
          )}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Prize */}
      <div className="flex flex-col gap-2 ml-6">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
          Premio
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
          <FormField id={`prize-kind-${segment.id}`} label="Tipo">
            <Select
              id={`prize-kind-${segment.id}`}
              value={kind}
              onChange={(e) =>
                onUpdatePrize({ kind: e.target.value as WheelPrizeKind })
              }
            >
              <option value="bonus">Bono</option>
              <option value="try_again">Sin premio</option>
            </Select>
          </FormField>

          {isBonus && (
            <FormField
              id={`prize-bonus-${segment.id}`}
              label="Elegí un bono"
              hint="La planilla define monto y condiciones."
            >
              {bonusDefinitions.length > 0 ? (
                <Select
                  id={`prize-bonus-${segment.id}`}
                  value={segment.prize.definitionId ?? ''}
                  onChange={(e) => handleBonusChange(e.target.value)}
                >
                  <option value="">— Seleccionar bono —</option>
                  {bonusDefinitions.map((def) => (
                    <option key={def.id} value={def.id}>
                      {bonusLabel(def)}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={`prize-bonus-${segment.id}`}
                  type="text"
                  value={segment.prize.definitionId ?? ''}
                  onChange={(e) =>
                    onUpdatePrize({ definitionId: e.target.value })
                  }
                  placeholder="ID de plantilla de bono"
                  className="font-mono text-[11px]"
                />
              )}
            </FormField>
          )}

          {isBonus && selectedBonus && (
            <div className="col-span-full flex items-center gap-2 text-[10px] text-[var(--color-fg-muted)] bg-[var(--color-bg-subtle)] px-2 py-1.5 rounded">
              <span className="font-medium text-[var(--color-fg)]">
                {selectedBonus.name}
              </span>
              <span>·</span>
              <span>Tipo: {selectedBonus.type}</span>
              {canonicalBonusAmount(selectedBonus) && (
                <>
                  <span>·</span>
                  <span>{canonicalBonusAmount(selectedBonus)} fichas</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/* ── WheelPreview — mini SVG ───────────────────────────────────────── */

function WheelPreview({ segments }: { segments: WheelSegment[] }) {
  const total = segments.reduce((acc, s) => acc + (s.probability || 0), 0);
  if (total <= 0 || segments.length === 0) return null;

  const SIZE = 120;
  const CENTER = SIZE / 2;
  const R = SIZE / 2 - 2;

  let cumulativeAngle = -90;

  const arcs = segments.map((seg, i) => {
    const pct = seg.probability / total;
    const startAngle = cumulativeAngle;
    const sweepAngle = pct * 360;
    cumulativeAngle += sweepAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = ((startAngle + sweepAngle) * Math.PI) / 180;

    const x1 = CENTER + R * Math.cos(startRad);
    const y1 = CENTER + R * Math.sin(startRad);
    const x2 = CENTER + R * Math.cos(endRad);
    const y2 = CENTER + R * Math.sin(endRad);

    const largeArc = sweepAngle > 180 ? 1 : 0;

    const d = [
      `M ${CENTER} ${CENTER}`,
      `L ${x1} ${y1}`,
      `A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2}`,
      'Z',
    ].join(' ');

    return (
      <path
        key={seg.id || i}
        d={d}
        fill={segmentColor(i)}
        stroke="var(--color-bg)"
        strokeWidth="1.5"
      />
    );
  });

  return (
    <div className="flex items-center gap-3 p-3 rounded-[var(--radius)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)]">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="size-[80px] shrink-0"
      >
        {arcs}
        <circle cx={CENTER} cy={CENTER} r="12" fill="var(--color-bg)" />
        <circle cx={CENTER} cy={CENTER} r="10" fill="var(--color-bg-elevated)" stroke="var(--color-border)" strokeWidth="1" />
      </svg>
      <div className="flex flex-col gap-1 text-[10px] text-[var(--color-fg-muted)]">
        <span className="font-medium text-[var(--color-fg)] text-[11px]">Preview</span>
        {segments.map((seg, i) => (
          <div key={seg.id || i} className="flex items-center gap-1.5">
            <div
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: segmentColor(i) }}
            />
            <span className="truncate max-w-[120px]">
              {seg.label || `Gajo ${i + 1}`}
            </span>
            <span className="font-mono text-[var(--color-fg-subtle)]">
              {seg.probability}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── PrizeEditor (exportado para reuso en streak) ──────────────────── */

export function PrizeEditor({
  prize,
  onChange,
  bonusDefinitions = [],
}: {
  prize: WheelPrize;
  onChange: (patch: Partial<WheelPrize>) => void;
  bonusDefinitions?: BonusDefinition[];
}) {
  const kind = prize?.kind ?? 'bonus';
  const isBonus = kind === 'bonus';

  const selectedBonus = useMemo(
    () =>
      isBonus && prize.definitionId
        ? bonusDefinitions.find((d) => d.id === prize.definitionId)
        : undefined,
    [isBonus, prize.definitionId, bonusDefinitions],
  );

  const handleBonusChange = useCallback(
    (defId: string) => {
      const def = bonusDefinitions.find((d) => d.id === defId);
      if (def) {
        const amount = canonicalBonusAmount(def);
        onChange({
          definitionId: def.id,
          amount: amount ? Number(amount) : undefined,
          label: def.name,
        });
      } else {
        onChange({ definitionId: undefined });
      }
    },
    [bonusDefinitions, onChange],
  );

  return (
    <div className="flex flex-col gap-2 p-3 rounded-[var(--radius)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)]">
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
            <option value="bonus">Bono</option>
            <option value="try_again">Sin premio</option>
          </Select>
        </FormField>
        {isBonus && (
          <>
            {bonusDefinitions.length > 0 ? (
              <FormField id="prize-bonus" label="Elegí un bono">
                <Select
                  id="prize-bonus"
                  value={prize.definitionId ?? ''}
                  onChange={(e) => handleBonusChange(e.target.value)}
                >
                  <option value="">— Seleccionar bono —</option>
                  {bonusDefinitions.map((def) => (
                    <option key={def.id} value={def.id}>
                      {bonusLabel(def)}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : (
              <FormField id="prize-definition-id" label="Bonus definition ID">
                <Input
                  id="prize-definition-id"
                  type="text"
                  value={prize.definitionId ?? ''}
                  onChange={(e) =>
                    onChange({ definitionId: e.target.value })
                  }
                  placeholder="uuid de bonus_definition"
                  className="font-mono text-[11px]"
                />
              </FormField>
            )}
            {selectedBonus && (
              <div className="col-span-full flex items-center gap-2 text-[10px] text-[var(--color-fg-muted)] bg-[var(--color-bg-subtle)] px-2 py-1.5 rounded">
                <span className="font-medium text-[var(--color-fg)]">
                  {selectedBonus.name}
                </span>
                <span>·</span>
                <span>Tipo: {selectedBonus.type}</span>
                {canonicalBonusAmount(selectedBonus) && (
                  <>
                    <span>·</span>
                    <span>{canonicalBonusAmount(selectedBonus)} fichas</span>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Helpers públicos ──────────────────────────────────────────────── */

/**
 * Convierte el `config` jsonb crudo del backend a `WheelConfig` tipado.
 * Soporta escala 0-1 (fracción) y 0-100 (%). Si detecta fracciones,
 * las convierte a porcentaje para el editor.
 */
export function parseWheelConfig(raw: unknown): WheelConfig {
  if (raw && typeof raw === 'object' && 'segments' in raw) {
    const segs = (raw as { segments?: unknown }).segments;
    if (Array.isArray(segs)) {
      const parsed = segs.map((s, i) => normalizeSegment(s, i));
      const maxProb = Math.max(...parsed.map((s) => s.probability), 0);
      if (maxProb <= 1 && maxProb > 0) {
        return {
          segments: parsed.map((s) => ({
            ...s,
            probability: Math.round(s.probability * 100 * 100) / 100,
          })),
        };
      }
      return { segments: parsed };
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
          : 'bonus',
      amount: typeof prize.amount === 'number' ? prize.amount : undefined,
      definitionId:
        typeof prize.definitionId === 'string'
          ? prize.definitionId
          : undefined,
      description:
        typeof prize.description === 'string'
          ? prize.description
          : undefined,
      label: typeof prize.label === 'string' ? prize.label : undefined,
    },
  };
}
