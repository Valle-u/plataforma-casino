/**
 * /play/settings â€” Juego responsable (lÃ­mites self-service + auto-exclusiÃ³n).
 *
 * Sprint 33. Backend: `/tenant/responsible-gaming/me`.
 *
 * ComposiciÃ³n:
 *   - Si hay exclusion activa: banner rojo arriba con tipo + endsAt.
 *     (El user no puede revertir self-exclusion â€” solo el admin/soporte).
 *   - SecciÃ³n "LÃ­mites": 3 inputs (daily/weekly/monthly). VacÃ­o = sin lÃ­mite.
 *     BotÃ³n Guardar al final.
 *   - SecciÃ³n "Auto-excluirme": picker de tipo (cool_off/temporary/permanent),
 *     date picker condicional (no para permanent), reason opcional, botÃ³n
 *     destructivo con ConfirmModal.
 *
 * PolÃ­tica UX:
 *   - El player NO puede LEVANTAR su propia exclusion. Si quiere reactivar
 *     la cuenta antes del endsAt, contactar a soporte. Eso lo dice un
 *     hint visible en el banner.
 *   - "Permanent" muestra warning explÃ­cito de que el admin tiene que
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
      <div className="max-w-[800px] mx-auto px-6 py-10 flex flex-col gap-8">
        <Skeleton className="h-12 w-64 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-32 w-full bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-48 w-full bg-[var(--color-bg-subtle)]" />
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Shield className="size-3" />
          Mi cuenta
        </span>
        <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
          Juego responsable
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          ConfigurÃ¡ lÃ­mites para vos mismo o bloqueÃ¡ tu cuenta temporalmente
          si lo necesitÃ¡s.
        </p>
      </header>

      {rg.data?.exclusion && <ExclusionBanner exclusion={rg.data.exclusion} />}

      <LimitsSection
        settings={rg.data?.settings ?? null}
        disabled={!!rg.data?.exclusion}
      />

      {!rg.data?.exclusion && <ExclusionSection />}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Exclusion banner (si ya tiene una activa)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
            Tu cuenta estÃ¡ bloqueada
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
          Vigente hasta: <span className="font-mono">{until}</span>. No podÃ©s
          depositar ni operar mientras estÃ© activa. Si querÃ©s levantar el
          bloqueo antes, contactÃ¡ a soporte â€”{' '}
          <span className="text-[var(--color-fg-subtle)]">
            la auto-exclusiÃ³n NO puede ser revertida por vos mismo.
          </span>
        </p>
      </div>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LÃ­mites de depÃ³sito
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      toast.success('LÃ­mites actualizados');
    } catch (err) {
      toast.error('No se pudo actualizar', {
        description: isApiError(err) ? err.message : 'Error de conexiÃ³n.',
      });
    }
  }

  return (
    <section className="flex flex-col gap-4 p-5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          LÃ­mites de depÃ³sito
        </span>
        <p className="text-[12px] text-[var(--color-fg-subtle)] leading-relaxed">
          DejÃ¡ vacÃ­o para "sin lÃ­mite". Los caps se cuentan en chips.
          Cualquier intento de depÃ³sito que exceda alguno serÃ¡ rechazado.
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
            placeholder="Sin lÃ­mite"
            className="font-mono"
            disabled={disabled}
          />
        </FormField>
        <FormField id="rg-weekly" label="Semanal" hint="Ãšltimos 7 dÃ­as.">
          <Input
            id="rg-weekly"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={weekly}
            onChange={(e) => setWeekly(e.target.value)}
            placeholder="Sin lÃ­mite"
            className="font-mono"
            disabled={disabled}
          />
        </FormField>
        <FormField id="rg-monthly" label="Mensual" hint="Ãšltimos 30 dÃ­as.">
          <Input
            id="rg-monthly"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            placeholder="Sin lÃ­mite"
            className="font-mono"
            disabled={disabled}
          />
        </FormField>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
        {settings?.updatedAt && (
          <span className="text-[11px] text-[var(--color-fg-subtle)] mr-auto">
            Ãšltima actualizaciÃ³n: {formatDate(settings.updatedAt)}
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
              Guardandoâ€¦
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              Guardar lÃ­mites
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Auto-excluirme
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ExclusionSection() {
  const exclude = useSelfExclude();
  const [type, setType] = useState<SelfExclusionType>('cool_off');
  const [endsAtLocal, setEndsAtLocal] = useState<string>(() =>
    defaultEndsAt(1),
  );
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Default endsAt sugerido segÃºn tipo.
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
        description: isApiError(err) ? err.message : 'Error de conexiÃ³n.',
      });
    }
  }

  return (
    <section className="flex flex-col gap-4 p-5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <AlertCircle className="size-3" />
          Auto-excluirme
        </span>
        <p className="text-[12px] text-[var(--color-fg-subtle)] leading-relaxed">
          BloqueÃ¡ tu cuenta voluntariamente. Una vez activado el bloqueo,
          NO podÃ©s desbloquearlo por vos mismo â€” sÃ³lo soporte puede.
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
        title="Confirmar auto-exclusiÃ³n"
        description={
          type === 'permanent'
            ? 'EstÃ¡s a punto de bloquear tu cuenta de forma PERMANENTE. Solo soporte podrÃ¡ revocarlo.'
            : `EstÃ¡s a punto de bloquear tu cuenta hasta el ${new Date(
                endsAtLocal,
              ).toLocaleString('es-AR')}.`
        }
        warning="No podrÃ¡s desbloquearla por vos mismo. Tu wallet quedarÃ¡ intacto, pero no podrÃ¡s loguear ni depositar."
        confirmLabel="Bloquear cuenta"
        confirmIcon={<Lock className="size-3.5" />}
        confirmVariant="outline-accent"
        onConfirm={handleConfirm}
        isPending={exclude.isPending}
      />
    </section>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function describeType(t: SelfExclusionType): string {
  if (t === 'cool_off') return 'Bloqueo corto (24h-7d). Sugerido para pausa.';
  if (t === 'temporary') return 'Bloqueo mÃ¡s largo (semanas/meses).';
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
