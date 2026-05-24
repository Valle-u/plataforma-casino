/**
 * /play/settings — Juego responsable (límites self-service + auto-exclusión).
 *
 * Sprint 33. Backend: `/tenant/responsible-gaming/me`.
 *
 * Composición:
 *   - Si hay exclusion activa: banner rojo arriba con tipo + endsAt.
 *     (El user no puede revertir self-exclusion — solo el admin/soporte).
 *   - Sección "Límites": 3 inputs (daily/weekly/monthly). Vacío = sin límite.
 *     Botón Guardar al final.
 *   - Sección "Auto-excluirme": picker de tipo (cool_off/temporary/permanent),
 *     date picker condicional (no para permanent), reason opcional, botón
 *     destructivo con ConfirmModal.
 *
 * Política UX:
 *   - El player NO puede LEVANTAR su propia exclusion. Si quiere reactivar
 *     la cuenta antes del endsAt, contactar a soporte. Eso lo dice un
 *     hint visible en el banner.
 *   - "Permanent" muestra warning explícito de que el admin tiene que
 *     revocar manualmente.
 */

'use client';

import {
  AlertCircle,
  Calendar,
  Check,
  Lock,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SwitchRow } from '@/components/ui/switch';
import { resetWelcomeTour } from '@/components/player/welcome-tour';
import { useTheme, THEMES, type ThemeId } from '@/lib/hooks/use-theme';
import { getSoundsEnabled, setSoundsEnabled, soundClick } from '@/lib/sounds';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/api-client';
import {
  useMyResponsibleGaming,
  useSelfExclude,
  useUpsertMyLimits,
  type SelfExclusion,
  type SelfExclusionType,
} from '@/lib/hooks/use-responsible-gaming';

export default function PlaySettingsPage() {
  const rg = useMyResponsibleGaming();

  if (rg.isLoading) {
    return (
      <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6 sm:gap-8">
        <Skeleton className="h-12 w-64 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-32 w-full bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-48 w-full bg-[var(--color-bg-subtle)]" />
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6 sm:gap-8">
      <header className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Shield className="size-3" />
          Mi cuenta
        </span>
        <h1 className="font-display text-2xl sm:text-[2.5rem] leading-tight sm:leading-none tracking-tight">
          Juego responsable
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          Configurá límites para vos mismo o bloqueá tu cuenta temporalmente
          si lo necesitás.
        </p>
      </header>

      {rg.data?.exclusion && <ExclusionBanner exclusion={rg.data.exclusion} />}

      <LimitsSection
        settings={rg.data?.settings ?? null}
        disabled={!!rg.data?.exclusion}
      />

      {!rg.data?.exclusion && <ExclusionSection />}

      {/* Sprint 51.27: preferencias visuales (live wins ticker on/off) */}
      <UiPreferencesSection />
    </div>
  );
}

/**
 * UiPreferencesSection — Sprint 51.27.
 *
 * Toggles puramente cosméticos persistidos en localStorage. Por ahora
 * sólo el live wins ticker, pero acá vamos a sumar más (sounds, themes,
 * compact mode, etc.).
 */
function UiPreferencesSection() {
  const { theme, setTheme } = useTheme();
  const [tickerEnabled, setTickerEnabled] = useState<boolean>(true);
  const [soundsOn, setSoundsOn] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const tickerStored = localStorage.getItem(
        'casino:live-wins-ticker:enabled',
      );
      if (tickerStored === '0') setTickerEnabled(false);
    } catch {
      /* ignore */
    }
    setSoundsOn(getSoundsEnabled());
  }, []);

  const toggleTicker = (next: boolean) => {
    setTickerEnabled(next);
    try {
      localStorage.setItem(
        'casino:live-wins-ticker:enabled',
        next ? '1' : '0',
      );
    } catch {
      /* ignore */
    }
  };

  const toggleSounds = (next: boolean) => {
    setSoundsOn(next);
    setSoundsEnabled(next);
    if (next) soundClick(); // sample inmediato cuando lo prendés
  };

  return (
    <section className="flex flex-col gap-5 p-5 card-premium rounded-[var(--radius-lg)]">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          Preferencias visuales
        </span>
        <h2 className="font-display text-xl tracking-tight text-[var(--color-fg)]">
          Tu experiencia
        </h2>
      </div>

      {/* Theme picker — Sprint 51.29 */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">
            Tema del acento
          </span>
          <p className="text-[11px] text-[var(--color-fg-muted)] leading-snug">
            Elegí qué color domina botones, alertas y elementos activos.
            El branding del tenant (si lo hay) gana sobre tu elección.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => {
            const t = THEMES[id];
            const active = theme === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTheme(id);
                  soundClick();
                }}
                aria-pressed={active}
                aria-label={`Tema ${t.label}`}
                className={cn(
                  'group/swatch relative flex items-center gap-2 pl-1.5 pr-3 h-9',
                  'rounded-full border transition-all',
                  active
                    ? 'border-[var(--color-fg)] bg-[var(--color-bg-subtle)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-subtle)]',
                )}
              >
                <span
                  className="size-6 rounded-full shrink-0 ring-1 ring-white/20"
                  style={{
                    background: `radial-gradient(circle at 30% 30%, ${t.swatch}ee, ${t.swatch}88)`,
                    boxShadow: active
                      ? `0 0 12px ${t.swatch}80`
                      : undefined,
                  }}
                  aria-hidden
                />
                <span
                  className={cn(
                    'text-[12px] tracking-tight',
                    active
                      ? 'text-[var(--color-fg)] font-medium'
                      : 'text-[var(--color-fg-muted)]',
                  )}
                >
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-[var(--color-border)]" />

      <SwitchRow
        label="Sonidos de la plataforma"
        hint="Pequeños beeps sintéticos al ganar, reclamar premios y notificaciones. Default off, opt-in."
        checked={soundsOn}
        onChange={toggleSounds}
      />

      <div className="h-px bg-[var(--color-border)]" />

      <SwitchRow
        label="Feed de ganadores en vivo"
        hint="Mini cards arriba a la izquierda mostrando quiénes ganan en otros juegos. Genera FOMO pero algunos prefieren minimal."
        checked={tickerEnabled}
        onChange={toggleTicker}
      />

      <div className="h-px bg-[var(--color-border)]" />

      {/* Sprint 51.35: re-disparar el welcome tour si el user lo quiere
        * volver a ver. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">
            Tour de bienvenida
          </span>
          <p className="text-[11px] text-[var(--color-fg-muted)] leading-snug">
            Volvé a ver el recorrido inicial — 5 slides con lo básico de
            la plataforma.
          </p>
        </div>
        <Button
          variant="premium-ghost"
          size="md"
          onClick={resetWelcomeTour}
          className="shrink-0"
        >
          Ver tour
        </Button>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Exclusion banner (si ya tiene una activa)
// ──────────────────────────────────────────────────────────────────────

function ExclusionBanner({ exclusion }: { exclusion: SelfExclusion }) {
  const until =
    exclusion.endsAt === null
      ? 'permanente'
      : new Date(exclusion.endsAt).toLocaleString('es-AR', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  return (
    <div className="flex items-start gap-3 p-4 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
      <Lock className="size-4 text-[var(--color-accent-text)] shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">
            Tu cuenta está bloqueada
          </span>
          <Badge variant="danger" dot>
            {exclusion.type === 'cool_off'
              ? 'cool-off'
              : exclusion.type === 'temporary'
                ? 'temporal'
                : 'permanente'}
          </Badge>
        </div>
        <p className="text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
          Vigente hasta: <span className="font-mono">{until}</span>. No podés
          depositar ni operar mientras esté activa. Si querés levantar el
          bloqueo antes, contactá a soporte —{' '}
          <span className="text-[var(--color-fg-subtle)]">
            la auto-exclusión NO puede ser revertida por vos mismo.
          </span>
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Límites de depósito
// ──────────────────────────────────────────────────────────────────────

function LimitsSection({
  settings,
  disabled,
}: {
  settings: import('@/lib/hooks/use-responsible-gaming').RgSettings | null;
  disabled: boolean;
}) {
  const upsert = useUpsertMyLimits();
  const [daily, setDaily] = useState('');
  const [weekly, setWeekly] = useState('');
  const [monthly, setMonthly] = useState('');

  useEffect(() => {
    setDaily(settings?.depositLimitDaily ?? '');
    setWeekly(settings?.depositLimitWeekly ?? '');
    setMonthly(settings?.depositLimitMonthly ?? '');
  }, [settings]);

  const isDirty = useMemo(() => {
    const norm = (s: string | null | undefined) =>
      s && s.trim() !== '' ? String(Number(s)) : '';
    return (
      norm(daily) !== norm(settings?.depositLimitDaily) ||
      norm(weekly) !== norm(settings?.depositLimitWeekly) ||
      norm(monthly) !== norm(settings?.depositLimitMonthly)
    );
  }, [daily, weekly, monthly, settings]);

  function parse(s: string): string | null {
    const trimmed = s.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return n.toFixed(2);
  }

  async function handleSave() {
    try {
      await upsert.mutateAsync({
        depositLimitDaily: parse(daily),
        depositLimitWeekly: parse(weekly),
        depositLimitMonthly: parse(monthly),
      });
      toast.success('Límites actualizados');
    } catch (err) {
      toast.error('No se pudo actualizar', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  }

  return (
    <section className="flex flex-col gap-4 p-5 card-premium rounded-[var(--radius-lg)]">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          Límites de depósito
        </span>
        <p className="text-[12px] text-[var(--color-fg-subtle)] leading-relaxed">
          Dejá vacío para "sin límite". Los caps se cuentan en chips.
          Cualquier intento de depósito que exceda alguno será rechazado.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField id="rg-daily" label="Diario" hint="Reset 00:00 UTC.">
          <Input
            id="rg-daily"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
            placeholder="Sin límite"
            className="font-mono"
            disabled={disabled}
          />
        </FormField>
        <FormField id="rg-weekly" label="Semanal" hint="Últimos 7 días.">
          <Input
            id="rg-weekly"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={weekly}
            onChange={(e) => setWeekly(e.target.value)}
            placeholder="Sin límite"
            className="font-mono"
            disabled={disabled}
          />
        </FormField>
        <FormField id="rg-monthly" label="Mensual" hint="Últimos 30 días.">
          <Input
            id="rg-monthly"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            placeholder="Sin límite"
            className="font-mono"
            disabled={disabled}
          />
        </FormField>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
        {settings?.updatedAt && (
          <span className="text-[11px] text-[var(--color-fg-subtle)] mr-auto">
            Última actualización: {formatDate(settings.updatedAt)}
          </span>
        )}
        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={disabled || !isDirty || upsert.isPending}
        >
          {upsert.isPending ? (
            <>
              <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
              Guardando…
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              Guardar límites
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Auto-excluirme
// ──────────────────────────────────────────────────────────────────────

function ExclusionSection() {
  const exclude = useSelfExclude();
  const [type, setType] = useState<SelfExclusionType>('cool_off');
  const [endsAtLocal, setEndsAtLocal] = useState<string>(() =>
    defaultEndsAt(1),
  );
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Default endsAt sugerido según tipo.
  useEffect(() => {
    if (type === 'cool_off') setEndsAtLocal(defaultEndsAt(1));
    else if (type === 'temporary') setEndsAtLocal(defaultEndsAt(30));
    // permanent no usa endsAt
  }, [type]);

  async function handleConfirm() {
    try {
      await exclude.mutateAsync({
        type,
        endsAt:
          type === 'permanent'
            ? undefined
            : new Date(endsAtLocal).toISOString(),
        reason: reason.trim() === '' ? undefined : reason.trim(),
      });
      toast.success('Bloqueo activado');
      setConfirmOpen(false);
    } catch (err) {
      toast.error('No se pudo bloquear la cuenta', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  }

  return (
    <section className="flex flex-col gap-4 p-5 card-premium rounded-[var(--radius-lg)]">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <AlertCircle className="size-3" />
          Auto-excluirme
        </span>
        <p className="text-[12px] text-[var(--color-fg-subtle)] leading-relaxed">
          Bloqueá tu cuenta voluntariamente. Una vez activado el bloqueo,
          NO podés desbloquearlo por vos mismo — sólo soporte puede.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField id="rg-type" label="Tipo" hint={describeType(type)}>
          <Select
            id="rg-type"
            value={type}
            onChange={(e) => setType(e.target.value as SelfExclusionType)}
          >
            <option value="cool_off">Cool-off (corto)</option>
            <option value="temporary">Temporal</option>
            <option value="permanent">Permanente</option>
          </Select>
        </FormField>
        {type !== 'permanent' && (
          <FormField id="rg-endsat" label="Hasta">
            <Input
              id="rg-endsat"
              type="datetime-local"
              value={endsAtLocal}
              onChange={(e) => setEndsAtLocal(e.target.value)}
            />
          </FormField>
        )}
      </div>

      <FormField id="rg-reason" label="Motivo (opcional)">
        <Input
          id="rg-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Para tu propio registro / soporte"
        />
      </FormField>

      <div className="flex items-center justify-end pt-2 border-t border-[var(--color-border)]">
        <Button
          variant="outline-accent"
          size="md"
          onClick={() => setConfirmOpen(true)}
        >
          <Lock className="size-3.5" />
          Bloquear mi cuenta
        </Button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirmar auto-exclusión"
        description={
          type === 'permanent'
            ? 'Estás a punto de bloquear tu cuenta de forma PERMANENTE. Solo soporte podrá revocarlo.'
            : `Estás a punto de bloquear tu cuenta hasta el ${new Date(
                endsAtLocal,
              ).toLocaleString('es-AR')}.`
        }
        warning="No podrás desbloquearla por vos mismo. Tu wallet quedará intacto, pero no podrás loguear ni depositar."
        confirmLabel="Bloquear cuenta"
        confirmIcon={<Lock className="size-3.5" />}
        confirmVariant="outline-accent"
        onConfirm={handleConfirm}
        isPending={exclude.isPending}
      />
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function describeType(t: SelfExclusionType): string {
  if (t === 'cool_off') return 'Bloqueo corto (24h-7d). Sugerido para pausa.';
  if (t === 'temporary') return 'Bloqueo más largo (semanas/meses).';
  return 'PERMANENTE. Solo soporte revoca.';
}

function defaultEndsAt(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// Suppress unused warnings for icons that may be reserved for future use.
void Calendar;
void RefreshCw;
