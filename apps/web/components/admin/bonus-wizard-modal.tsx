/**
 * BonusWizardModal — Sprint 48.
 *
 * Wizard step-by-step para crear `bonus_definitions` sin tener que
 * editar JSON crudo. Reemplaza el flow técnico del `CreateBonusDefinitionModal`
 * actual (que pide config como JSON).
 *
 * Pedido del dueño 2026-05-20 item D: "hagamos más simple a la hora
 * de crear plantillas de bonos, ya que no se entiende la configuración".
 *
 * Steps:
 *   1. Tipo de bono — cards visuales con descripción humana.
 *   2. Identidad — nombre + código auto-generado + estado inicial.
 *   3. Configuración — campos guiados por type con sliders + previews.
 *   4. Vencimiento — días para expirar.
 *   5. Preview + confirmar — ejemplo concreto del comportamiento.
 *
 * Presets en step 1: pre-cargan los siguientes steps con valores típicos.
 *
 * Tooltips: cada campo "técnico" tiene icono <HelpCircle> con explicación.
 *
 * Sin tocar backend ni schema — el output final es el mismo payload que
 * el modal viejo, solo armado con UX mejor.
 */

'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Coins,
  Gift,
  HandCoins,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isApiError } from '@/lib/api-client';
import {
  useCreateBonusDefinition,
  type BonusType,
  type CreateBonusDefinitionPayload,
} from '@/lib/hooks/use-bonuses';
import { cn } from '@/lib/cn';

// ──────────────────────────────────────────────────────────────────────
// Catálogo de tipos con metadata humana
// ──────────────────────────────────────────────────────────────────────

type TypeMeta = {
  value: BonusType;
  label: string;
  tagline: string;
  description: string;
  icon: typeof Gift;
};

const TYPE_META: TypeMeta[] = [
  {
    value: 'welcome',
    label: 'Bienvenida',
    tagline: 'Regalo por primer depósito',
    description:
      'Multiplicá el primer depósito del jugador por un porcentaje. Ej: deposita $1000, recibe $1500 (50% extra).',
    icon: Gift,
  },
  {
    value: 'reload',
    label: 'Recarga',
    tagline: 'Bonus en depósitos siguientes',
    description:
      'Igual que bienvenida pero para depósitos recurrentes. Sirve para fidelizar y reactivar.',
    icon: Wallet,
  },
  {
    value: 'manual',
    label: 'Manual',
    tagline: 'Otorgar a discreción del cajero',
    description:
      'El cajero decide cuándo y a quién darlo, con un monto fijo. Útil para compensaciones puntuales.',
    icon: HandCoins,
  },
];

// ──────────────────────────────────────────────────────────────────────
// Presets — pre-cargan steps típicos
// ──────────────────────────────────────────────────────────────────────

interface Preset {
  id: string;
  label: string;
  description: string;
  apply: () => Partial<WizardState>;
}

const PRESETS: Preset[] = [
  {
    id: 'welcome_100',
    label: 'Bienvenida 100% hasta $5000',
    description: 'Match 100% con tope.',
    apply: () => ({
      type: 'welcome',
      name: 'Bono de bienvenida 100%',
      code: 'welcome_100_2026',
      expirationDays: 30,
      configWelcome: { matchPct: 100, maxAmount: '5000', minDeposit: '500' },
    }),
  },
  {
    id: 'cashback_weekly_10',
    label: 'Cashback semanal 10%',
    description: 'Devuelve 10% de las pérdidas cada 7 días.',
    apply: () => ({
      type: 'cashback',
      name: 'Cashback semanal',
      code: 'cashback_weekly',
      expirationDays: 14,
      configCashback: { pct: 10, periodDays: 7 },
    }),
  },
  {
    id: 'no_deposit_500',
    label: 'Sin depósito $500',
    description: 'Regalo fijo $500 para jugadores nuevos.',
    apply: () => ({
      type: 'no_deposit',
      name: 'Bono sin depósito $500',
      code: 'no_deposit_500',
      expirationDays: 7,
      configNoDeposit: { amount: '500' },
    }),
  },
];

// ──────────────────────────────────────────────────────────────────────
// Estado del wizard
// ──────────────────────────────────────────────────────────────────────

interface WizardState {
  type: BonusType | null;
  name: string;
  code: string;
  status: 'draft' | 'active';
  expirationDays: number;
  // Configs por type — solo se usa el del type seleccionado.
  configWelcome: { matchPct: number; maxAmount: string; minDeposit: string };
  configReload: { matchPct: number; maxAmount: string };
  configCashback: { pct: number; periodDays: number };
  configNoDeposit: { amount: string };
  configManual: { defaultAmount: string };
  configFreeSpins: { gameCode: string; spinCount: number; spinValue: string };
  configReferral: {
    referrerAmount: string;
    referredAmount: string;
    conditionEvent: string;
  };
}

const INITIAL_STATE: WizardState = {
  type: null,
  name: '',
  code: '',
  status: 'draft',
  expirationDays: 30,
  configWelcome: { matchPct: 100, maxAmount: '5000', minDeposit: '0' },
  configReload: { matchPct: 50, maxAmount: '2000' },
  configCashback: { pct: 10, periodDays: 7 },
  configNoDeposit: { amount: '500' },
  configManual: { defaultAmount: '1000' },
  configFreeSpins: { gameCode: '', spinCount: 20, spinValue: '1' },
  configReferral: {
    referrerAmount: '1000',
    referredAmount: '500',
    conditionEvent: 'first_deposit',
  },
};

const STEPS = [
  { id: 1, label: 'Tipo' },
  { id: 2, label: 'Identidad' },
  { id: 3, label: 'Configuración' },
  { id: 4, label: 'Vencimiento' },
  { id: 5, label: 'Confirmar' },
] as const;

// ──────────────────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────────────────

interface BonusWizardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BonusWizardModal({ open, onOpenChange }: BonusWizardModalProps) {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const create = useCreateBonusDefinition();

  function reset() {
    setStep(1);
    setState(INITIAL_STATE);
  }

  function close() {
    onOpenChange(false);
    // Reset diferido — para que el cierre animado no muestre el reset.
    setTimeout(reset, 250);
  }

  function applyPreset(p: Preset) {
    setState((s) => ({ ...s, ...p.apply() }));
    setStep(2);
  }

  function updateState(patch: Partial<WizardState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  async function submit() {
    const payload = buildPayload(state);
    if (!payload) {
      toast.error('Falta completar campos requeridos');
      return;
    }
    try {
      const created = await create.mutateAsync(payload);
      toast.success('Plantilla creada', {
        description: `${created.code} · ${created.type} · ${created.status}`,
      });
      close();
    } catch (err) {
      toast.error('No se pudo crear', { description: mapError(err) });
    }
  }

  // Validación por step.
  const canAdvance =
    step === 1
      ? state.type !== null
      : step === 2
        ? state.name.length >= 3 && /^[a-z0-9][a-z0-9_-]{1,49}$/.test(state.code)
        : step === 3
          ? validateConfig(state)
          : step === 4
            ? state.expirationDays >= 1 && state.expirationDays <= 3650
            : true;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[3px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(880px,95vw)] max-h-[92vh] flex flex-col bg-[var(--color-bg-elevated)] border border-[var(--color-border-strong)] border-t-2 border-t-[var(--color-accent)] shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <header className="flex items-start justify-between gap-4 p-5 bg-[var(--color-bg-subtle)]/50 border-b border-[var(--color-border)]">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-[15px] font-medium text-[var(--color-fg)] flex items-center gap-2">
                <Sparkles className="size-4 text-[var(--color-accent-text)]" />
                Nueva plantilla de bono
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-[var(--color-fg-muted)]">
                Paso {step} de {STEPS.length} ·{' '}
                {STEPS.find((s) => s.id === step)?.label}
              </Dialog.Description>
            </div>
            <button
              type="button"
              onClick={close}
              className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </button>
          </header>

          {/* Stepper */}
          <nav className="flex items-center gap-1 px-5 py-3 border-b border-[var(--color-border)] overflow-x-auto">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center gap-1 shrink-0">
                <div
                  className={cn(
                    'flex items-center gap-2 px-2.5 h-7 text-[11px] uppercase tracking-[0.08em]',
                    s.id === step
                      ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)]'
                      : s.id < step
                        ? 'text-[var(--color-fg-muted)]'
                        : 'text-[var(--color-fg-subtle)]',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-4 items-center justify-center font-mono text-[10px]',
                      s.id < step
                        ? 'bg-[var(--color-success)] text-[var(--color-fg)]'
                        : s.id === step
                          ? 'bg-[var(--color-accent-fg)] text-[var(--color-accent)]'
                          : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-subtle)]',
                    )}
                  >
                    {s.id < step ? <Check className="size-2.5" /> : s.id}
                  </span>
                  {s.label}
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="size-3 text-[var(--color-fg-disabled)]" />
                )}
              </div>
            ))}
          </nav>

          {/* Body — scroll area */}
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
            {step === 1 && <StepType state={state} onChange={updateState} onPreset={applyPreset} />}
            {step === 2 && <StepIdentity state={state} onChange={updateState} />}
            {step === 3 && <StepConfig state={state} onChange={updateState} />}
            {step === 4 && <StepRestrictions state={state} onChange={updateState} />}
            {step === 5 && <StepPreview state={state} />}
          </div>

          {/* Footer nav */}
          <footer className="flex items-center justify-between gap-3 p-4 border-t border-[var(--color-border)]">
            <Button
              variant="ghost"
              size="md"
              onClick={() => (step === 1 ? close() : setStep((s) => s - 1))}
              disabled={create.isPending}
            >
              {step === 1 ? (
                'Cancelar'
              ) : (
                <>
                  <ArrowLeft className="size-3.5" />
                  Atrás
                </>
              )}
            </Button>
            {step < STEPS.length ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setStep((s) => s + 1)}
                disabled={!canAdvance}
              >
                Siguiente
                <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={submit}
                disabled={create.isPending}
              >
                {create.isPending ? (
                  <>
                    <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                    Creando…
                  </>
                ) : (
                  <>
                    <Check className="size-3.5" />
                    Crear plantilla
                  </>
                )}
              </Button>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 1 — Tipo + presets
// ──────────────────────────────────────────────────────────────────────

function StepType({
  state,
  onChange,
  onPreset,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  onPreset: (p: Preset) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle
        eyebrow="Paso 1"
        title="¿Qué tipo de bono querés crear?"
        hint="Elegí una plantilla rápida o un tipo desde cero."
      />

      {/* Presets */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreset(p)}
            className="flex flex-col gap-1 p-3 text-left border border-[var(--color-border)] bg-[var(--color-bg-subtle)] hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
              Preset
            </span>
            <span className="text-[12px] text-[var(--color-fg)]">{p.label}</span>
            <span className="text-[10px] text-[var(--color-fg-subtle)]">
              {p.description}
            </span>
          </button>
        ))}
      </div>

      <Divider label="o elegí desde cero" />

      {/* Tipos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {TYPE_META.map((t) => {
          const Icon = t.icon;
          const selected = state.type === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onChange({ type: t.value })}
              className={cn(
                'flex items-start gap-3 p-3 text-left border transition-colors',
                selected
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)]',
              )}
            >
              <Icon
                className={cn(
                  'size-5 shrink-0 mt-0.5',
                  selected ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg-muted)]',
                )}
              />
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-[var(--color-fg)] font-medium">
                    {t.label}
                  </span>
                  {selected && (
                    <Badge variant="neutral">
                      <Check className="size-2.5" />
                      Seleccionado
                    </Badge>
                  )}
                </div>
                <span className="text-[11px] text-[var(--color-fg-muted)]">
                  {t.tagline}
                </span>
                <p className="text-[11px] text-[var(--color-fg-subtle)] leading-relaxed">
                  {t.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 2 — Identidad
// ──────────────────────────────────────────────────────────────────────

function StepIdentity({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  // Auto-generar code desde name si el code está vacío.
  function handleNameChange(name: string) {
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50);
    onChange({ name, code: state.code || slug });
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionTitle
        eyebrow="Paso 2"
        title="Identificá la plantilla"
        hint="Un nombre que vos y tu equipo entiendan, y un código único."
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bw-name">
            Nombre visible <span className="text-[var(--color-accent-text)]">*</span>
          </Label>
          <Input
            id="bw-name"
            value={state.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Bono de bienvenida 100%"
            invalid={state.name.length > 0 && state.name.length < 3}
          />
          <Hint text="Como lo verás en listas y reportes. Mínimo 3 caracteres." />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bw-code">
            Código <span className="text-[var(--color-accent-text)]">*</span>{' '}
            <HelpTooltip text="Identificador único interno. Lo usás cuando integrás con triggers automáticos o APIs. Solo lowercase, dígitos, _ y -." />
          </Label>
          <Input
            id="bw-code"
            value={state.code}
            onChange={(e) => onChange({ code: e.target.value })}
            placeholder="welcome_100_2026"
            className="font-mono"
            invalid={
              state.code.length > 0 &&
              !/^[a-z0-9][a-z0-9_-]{1,49}$/.test(state.code)
            }
          />
          <Hint text="Auto-generado del nombre. Editable. Único intra-tenant. Ej: welcome_100_2026" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>
            Estado inicial <HelpTooltip text="Borrador: la creás pero no se puede otorgar todavía. Activa: lista para usar. Recomendado dejar en borrador hasta confirmar la configuración." />
          </Label>
          <div className="flex gap-2">
            {(['draft', 'active'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ status: s })}
                className={cn(
                  'flex-1 px-3 py-2.5 text-left border transition-colors',
                  state.status === s
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                    : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] hover:border-[var(--color-border-strong)]',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--color-fg)] font-medium">
                    {s === 'draft' ? 'Borrador' : 'Activa'}
                  </span>
                  {state.status === s && <Check className="size-3 text-[var(--color-accent-text)]" />}
                </div>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                  {s === 'draft' ? 'No otorgable todavía' : 'Lista para usar'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 3 — Config por type
// ──────────────────────────────────────────────────────────────────────

function StepConfig({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const type = state.type;
  if (!type) return null;

  return (
    <div className="flex flex-col gap-5">
      <SectionTitle
        eyebrow="Paso 3"
        title="¿Cuánto y cómo?"
        hint="Definí la lógica económica del bono. Vas a ver una previsualización en el último paso."
      />

      {(type === 'welcome' || type === 'reload') && (
        <MatchConfig
          isWelcome={type === 'welcome'}
          value={type === 'welcome' ? state.configWelcome : { ...state.configReload, minDeposit: '0' }}
          onChange={(c) =>
            onChange(
              type === 'welcome'
                ? { configWelcome: c }
                : { configReload: { matchPct: c.matchPct, maxAmount: c.maxAmount } },
            )
          }
        />
      )}

      {type === 'cashback' && (
        <CashbackConfig
          value={state.configCashback}
          onChange={(c) => onChange({ configCashback: c })}
        />
      )}

      {type === 'no_deposit' && (
        <AmountConfig
          label="Monto fijo a otorgar"
          help="Cantidad de fichas que recibe cada beneficiario."
          value={state.configNoDeposit.amount}
          onChange={(v) => onChange({ configNoDeposit: { amount: v } })}
        />
      )}

      {type === 'manual' && (
        <AmountConfig
          label="Monto sugerido"
          help="El cajero verá este valor pre-cargado al hacer un grant manual, pero puede modificarlo."
          value={state.configManual.defaultAmount}
          onChange={(v) => onChange({ configManual: { defaultAmount: v } })}
        />
      )}

      {type === 'free_spins' && (
        <FreeSpinsConfig
          value={state.configFreeSpins}
          onChange={(c) => onChange({ configFreeSpins: c })}
        />
      )}

      {type === 'referral' && (
        <ReferralConfig
          value={state.configReferral}
          onChange={(c) => onChange({ configReferral: c })}
        />
      )}
    </div>
  );
}

function MatchConfig({
  isWelcome,
  value,
  onChange,
}: {
  isWelcome: boolean;
  value: { matchPct: number; maxAmount: string; minDeposit: string };
  onChange: (v: { matchPct: number; maxAmount: string; minDeposit: string }) => void;
}) {
  const exampleDeposit = 1000;
  const exampleBonus = Math.min(
    (exampleDeposit * value.matchPct) / 100,
    Number(value.maxAmount) || Infinity,
  );

  return (
    <div className="flex flex-col gap-4">
      <SliderField
        label="Porcentaje de match"
        help="Multiplica el depósito por este %. Ej 100% = duplica el depósito en fichas (1 dep → 1 bonus). 50% = la mitad."
        min={0}
        max={200}
        step={5}
        suffix="%"
        value={value.matchPct}
        onChange={(n) => onChange({ ...value, matchPct: n })}
      />

      <NumberField
        label="Tope de bonus por transacción (fichas)"
        help="Máximo que se otorga aunque el match dé más. Ej con 100% y tope $5000: depositar $10000 da solo $5000 de bonus."
        value={value.maxAmount}
        onChange={(v) => onChange({ ...value, maxAmount: v })}
      />

      {isWelcome && (
        <NumberField
          label="Depósito mínimo para activar"
          help="Si depositan menos de este monto, no se otorga el bono. Dejar en 0 para no exigir mínimo."
          value={value.minDeposit}
          onChange={(v) => onChange({ ...value, minDeposit: v })}
        />
      )}

      <ExampleBox>
        Un jugador que deposita <strong>${exampleDeposit}</strong> recibe{' '}
        <strong className="text-[var(--color-success)]">${exampleBonus.toFixed(0)}</strong>{' '}
        de bonus
        {value.matchPct > 0 && Number(value.maxAmount) > 0 && exampleBonus === Number(value.maxAmount) && (
          <> (limitado por el tope)</>
        )}
        .
      </ExampleBox>
    </div>
  );
}

function CashbackConfig({
  value,
  onChange,
}: {
  value: { pct: number; periodDays: number };
  onChange: (v: { pct: number; periodDays: number }) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SliderField
        label="Porcentaje de devolución sobre pérdidas"
        help="% de lo que perdió en el período que se le devuelve. Ej 10% sobre $5000 perdidos = $500 cashback."
        min={1}
        max={50}
        step={1}
        suffix="%"
        value={value.pct}
        onChange={(n) => onChange({ ...value, pct: n })}
      />

      <div className="flex flex-col gap-1.5">
        <Label>Período de cálculo</Label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { v: 1, label: 'Diario' },
            { v: 7, label: 'Semanal' },
            { v: 30, label: 'Mensual' },
          ].map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => onChange({ ...value, periodDays: p.v })}
              className={cn(
                'px-3 py-2.5 text-[12px] border transition-colors',
                value.periodDays === p.v
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-fg)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)]',
              )}
            >
              {p.label}
              <div className="text-[10px] text-[var(--color-fg-subtle)]">
                cada {p.v} día{p.v > 1 ? 's' : ''}
              </div>
            </button>
          ))}
        </div>
      </div>

      <ExampleBox>
        Si perdió <strong>$5000</strong> en los últimos{' '}
        <strong>{value.periodDays}</strong> día{value.periodDays > 1 ? 's' : ''},
        recibe{' '}
        <strong className="text-[var(--color-success)]">
          ${((5000 * value.pct) / 100).toFixed(0)}
        </strong>{' '}
        de bonus.
      </ExampleBox>
    </div>
  );
}

function AmountConfig({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <NumberField label={label} help={help} value={value} onChange={onChange} />
      <ExampleBox>
        El beneficiario recibe{' '}
        <strong className="text-[var(--color-success)]">${value || '0'}</strong>{' '}
        en fichas.
      </ExampleBox>
    </div>
  );
}

function FreeSpinsConfig({
  value,
  onChange,
}: {
  value: { gameCode: string; spinCount: number; spinValue: string };
  onChange: (v: { gameCode: string; spinCount: number; spinValue: string }) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bw-game-code">
          Game code <HelpTooltip text="Código del juego elegible para las tiradas (ej. mock_lucky_seven). Tiene que coincidir con un juego activo del catálogo." />
        </Label>
        <Input
          id="bw-game-code"
          value={value.gameCode}
          onChange={(e) => onChange({ ...value, gameCode: e.target.value })}
          placeholder="mock_lucky_seven"
          className="font-mono"
        />
      </div>

      <SliderField
        label="Cantidad de tiradas"
        help="Cuántos spins gratis recibe el jugador."
        min={1}
        max={200}
        step={1}
        suffix=" spins"
        value={value.spinCount}
        onChange={(n) => onChange({ ...value, spinCount: n })}
      />

      <NumberField
        label="Valor por tirada (fichas)"
        help="Apuesta automática que se simula en cada spin gratis. Las ganancias se acreditan como bonus."
        value={value.spinValue}
        onChange={(v) => onChange({ ...value, spinValue: v })}
      />

      <ExampleBox>
        El jugador recibe <strong>{value.spinCount}</strong> tiradas de{' '}
        <strong>${value.spinValue}</strong> cada una en{' '}
        <strong className="font-mono">{value.gameCode || '(sin juego)'}</strong>.
      </ExampleBox>
    </div>
  );
}

function ReferralConfig({
  value,
  onChange,
}: {
  value: { referrerAmount: string; referredAmount: string; conditionEvent: string };
  onChange: (v: { referrerAmount: string; referredAmount: string; conditionEvent: string }) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <NumberField
        label="Bonus para quien invita"
        help="Fichas que recibe el referrer cuando el referido cumple la condición."
        value={value.referrerAmount}
        onChange={(v) => onChange({ ...value, referrerAmount: v })}
      />

      <NumberField
        label="Bonus para el invitado"
        help="Fichas que recibe el referido al cumplir la condición."
        value={value.referredAmount}
        onChange={(v) => onChange({ ...value, referredAmount: v })}
      />

      <div className="flex flex-col gap-1.5">
        <Label>Condición para activar</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { v: 'first_deposit', label: 'Primer depósito del invitado' },
            { v: 'registration', label: 'Solo registración' },
          ].map((c) => (
            <button
              key={c.v}
              type="button"
              onClick={() => onChange({ ...value, conditionEvent: c.v })}
              className={cn(
                'px-3 py-2.5 text-[12px] text-left border transition-colors',
                value.conditionEvent === c.v
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-fg)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)]',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <ExampleBox>
        Cuando el invitado cumple "
        <strong>
          {value.conditionEvent === 'first_deposit'
            ? 'su primer depósito'
            : 'registrarse'}
        </strong>
        ", el invitante recibe{' '}
        <strong className="text-[var(--color-success)]">${value.referrerAmount}</strong>{' '}
        y el invitado{' '}
        <strong className="text-[var(--color-success)]">${value.referredAmount}</strong>.
      </ExampleBox>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 4 — Vencimiento
// ──────────────────────────────────────────────────────────────────────

function StepRestrictions({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle
        eyebrow="Paso 4"
        title="Vencimiento"
        hint="¿Cuándo expira el bono?"
      />

      <div className="flex flex-col gap-1.5">
        <Label>
          Días para expirar{' '}
          <HelpTooltip text="Si el jugador no usa el bono antes de N días desde que se le otorga, caduca y se elimina automáticamente." />
        </Label>
        <div className="flex gap-2 flex-wrap">
          {[7, 14, 30, 60, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange({ expirationDays: d })}
              className={cn(
                'px-3 py-2 text-[12px] border transition-colors',
                state.expirationDays === d
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-fg)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)]',
              )}
            >
              {d} días
            </button>
          ))}
          <Input
            type="number"
            min={1}
            max={3650}
            value={state.expirationDays}
            onChange={(e) =>
              onChange({ expirationDays: Math.max(1, Math.min(3650, Number(e.target.value) || 1)) })
            }
            className="font-mono w-24"
          />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 5 — Preview
// ──────────────────────────────────────────────────────────────────────

function StepPreview({ state }: { state: WizardState }) {
  const typeMeta = TYPE_META.find((t) => t.value === state.type);
  if (!typeMeta) return null;

  const summary = renderSummary(state);

  return (
    <div className="flex flex-col gap-5">
      <SectionTitle
        eyebrow="Paso 5"
        title="Revisión final"
        hint="Confirmá que todo esté como esperás antes de crear."
      />

      <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border-strong)] p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <typeMeta.icon className="size-6 text-[var(--color-accent-text)] mt-0.5" />
          <div className="flex flex-col gap-1">
            <h3 className="text-[16px] text-[var(--color-fg)] font-medium">
              {state.name}
            </h3>
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-mono">
              {state.code} · {typeMeta.label}
            </span>
          </div>
          <div className="ml-auto">
            <Badge variant={state.status === 'active' ? 'success' : 'neutral'}>
              {state.status === 'active' ? 'Activa al crear' : 'Borrador'}
            </Badge>
          </div>
        </div>

        <hr className="border-[var(--color-border)]" />

        <div className="text-[13px] text-[var(--color-fg)] leading-relaxed">
          {summary}
        </div>

        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div className="flex flex-col gap-0.5">
            <span className="text-[var(--color-fg-subtle)] uppercase tracking-[0.08em]">
              Expira en
            </span>
            <span className="text-[var(--color-fg)] num font-mono">
              {state.expirationDays} días
            </span>
          </div>
        </div>
      </div>

      <details className="text-[11px]">
        <summary className="cursor-pointer text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)] font-mono uppercase tracking-[0.08em]">
          Ver JSON técnico (para devs)
        </summary>
        <pre className="mt-2 p-3 bg-[var(--color-bg)] border border-[var(--color-border)] overflow-x-auto text-[10px] text-[var(--color-fg-muted)] font-mono">
          {JSON.stringify(buildPayload(state), null, 2)}
        </pre>
      </details>
    </div>
  );
}

function renderSummary(state: WizardState): ReactNode {
  const t = state.type;
  if (t === 'welcome' || t === 'reload') {
    const matchPct = t === 'welcome' ? state.configWelcome.matchPct : state.configReload.matchPct;
    const maxAmount = t === 'welcome' ? state.configWelcome.maxAmount : state.configReload.maxAmount;
    const minDeposit = t === 'welcome' ? state.configWelcome.minDeposit : '0';
    const hasMin = Number(minDeposit) > 0;
    return (
      <>
        Cuando un jugador hace {t === 'welcome' ? 'su primer depósito' : 'una recarga'}{' '}
        {hasMin ? (
          <>
            de al menos <Token>${minDeposit}</Token>,
          </>
        ) : (
          ','
        )}{' '}
        recibe el <Token>{matchPct}%</Token> del depósito como bonus
        (hasta un máximo de <Token>${maxAmount}</Token>).
      </>
    );
  }
  if (t === 'cashback') {
    const labels: Record<number, string> = { 1: 'día', 7: 'semana', 30: 'mes' };
    const period = labels[state.configCashback.periodDays] ?? `${state.configCashback.periodDays} días`;
    return (
      <>
        Cada <Token>{period}</Token>, el sistema devuelve el{' '}
        <Token>{state.configCashback.pct}%</Token> de lo que el jugador perdió
        en ese período como bonus.
      </>
    );
  }
  if (t === 'no_deposit') {
    return (
      <>
        El beneficiario recibe <Token>${state.configNoDeposit.amount}</Token>{' '}
        sin necesidad de depositar nada.
      </>
    );
  }
  if (t === 'manual') {
    return (
      <>
        El cajero puede otorgar este bono manualmente a quien decida, con un
        monto sugerido de <Token>${state.configManual.defaultAmount}</Token>{' '}
        (editable al momento del grant).
      </>
    );
  }
  if (t === 'free_spins') {
    return (
      <>
        El jugador recibe <Token>{state.configFreeSpins.spinCount}</Token>{' '}
        tiradas gratis de <Token>${state.configFreeSpins.spinValue}</Token> cada una
        en el juego <Token>{state.configFreeSpins.gameCode || '(no definido)'}</Token>.
      </>
    );
  }
  if (t === 'referral') {
    return (
      <>
        Cuando un invitado cumple{' '}
        <Token>
          {state.configReferral.conditionEvent === 'first_deposit'
            ? 'su primer depósito'
            : 'registrarse'}
        </Token>
        , quien lo invitó recibe{' '}
        <Token>${state.configReferral.referrerAmount}</Token> y el invitado{' '}
        <Token>${state.configReferral.referredAmount}</Token>.
      </>
    );
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Sub-componentes UI reutilizables del wizard
// ──────────────────────────────────────────────────────────────────────

function SectionTitle({
  eyebrow,
  title,
  hint,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent-text)] font-medium">
        {eyebrow}
      </span>
      <h2 className="text-[18px] text-[var(--color-fg)] tracking-tight">{title}</h2>
      {hint && (
        <p className="text-[12px] text-[var(--color-fg-muted)] leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <span className="text-[10px] text-[var(--color-fg-subtle)] leading-relaxed">
      {text}
    </span>
  );
}

function HelpTooltip({ text }: { text: string }) {
  return (
    <span className="inline-flex" title={text}>
      <CircleHelp className="size-3 text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-text)] cursor-help" />
    </span>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-[var(--color-border)]" />
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <div className="flex-1 h-px bg-[var(--color-border)]" />
    </div>
  );
}

function SliderField({
  label,
  help,
  min,
  max,
  step,
  suffix,
  value,
  onChange,
}: {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label>
          {label} <HelpTooltip text={help} />
        </Label>
        <span className="text-[14px] font-mono num text-[var(--color-fg)] tabular-nums">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
      <div className="flex justify-between text-[10px] text-[var(--color-fg-disabled)] font-mono">
        <span>
          {min}
          {suffix}
        </span>
        <span>
          {max}
          {suffix}
        </span>
      </div>
    </div>
  );
}

function NumberField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label} <HelpTooltip text={help} />
      </Label>
      <div className="flex items-center gap-2">
        <Coins className="size-4 text-[var(--color-fg-subtle)]" />
        <Input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
          className="font-mono w-40"
          placeholder="0"
        />
      </div>
    </div>
  );
}

function ExampleBox({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[var(--color-bg-subtle)] border-l-2 border-l-[var(--color-accent)] border-y border-r border-[var(--color-border)] p-3 text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-mono block mb-1">
        Ejemplo
      </span>
      {children}
    </div>
  );
}

function Token({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[var(--color-fg)] bg-[var(--color-bg)] px-1.5 py-0.5 border border-[var(--color-border)]">
      {children}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Build + validation
// ──────────────────────────────────────────────────────────────────────

function validateConfig(state: WizardState): boolean {
  switch (state.type) {
    case 'welcome':
      return state.configWelcome.matchPct >= 0 && Number(state.configWelcome.maxAmount) > 0;
    case 'reload':
      return state.configReload.matchPct >= 0 && Number(state.configReload.maxAmount) > 0;
    case 'cashback':
      return state.configCashback.pct > 0 && state.configCashback.periodDays > 0;
    case 'no_deposit':
      return Number(state.configNoDeposit.amount) > 0;
    case 'manual':
      return Number(state.configManual.defaultAmount) > 0;
    case 'free_spins':
      return (
        state.configFreeSpins.gameCode.length > 0 &&
        state.configFreeSpins.spinCount > 0 &&
        Number(state.configFreeSpins.spinValue) > 0
      );
    case 'referral':
      return (
        Number(state.configReferral.referrerAmount) > 0 &&
        Number(state.configReferral.referredAmount) > 0
      );
    default:
      return false;
  }
}

function buildPayload(state: WizardState): CreateBonusDefinitionPayload | null {
  if (!state.type) return null;
  const cfg = (() => {
    switch (state.type) {
      case 'welcome':
        return {
          matchPct: state.configWelcome.matchPct,
          maxAmount: state.configWelcome.maxAmount,
          minDeposit: state.configWelcome.minDeposit,
        };
      case 'reload':
        return {
          matchPct: state.configReload.matchPct,
          maxAmount: state.configReload.maxAmount,
        };
      case 'cashback':
        return state.configCashback;
      case 'no_deposit':
        return state.configNoDeposit;
      case 'manual':
        return state.configManual;
      case 'free_spins':
        return state.configFreeSpins;
      case 'referral':
        return state.configReferral;
    }
  })();

  return {
    code: state.code,
    name: state.name,
    type: state.type,
    status: state.status,
    expirationDays: state.expirationDays,
    config: cfg,
  };
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) {
    if (err.code === 'BONUS_DEFINITION_CODE_CONFLICT') {
      return 'Ya existe una plantilla con ese código. Cambialo en el paso 2.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 403) return 'No tenés permiso para crear plantillas.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
