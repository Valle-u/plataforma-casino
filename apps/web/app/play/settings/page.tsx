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
  AtSign,
  Calendar,
  Check,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  ShieldCheck,
  User,
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
import { useAuth } from '@/lib/auth-context';
import { useTheme, THEMES, type ThemeId } from '@/lib/hooks/use-theme';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useVipTier } from '@/lib/hooks/use-vip-tier';
import { getSoundsEnabled, setSoundsEnabled, soundClick } from '@/lib/sounds';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/api-client';
import {
  useMyResponsibleGaming,
  useSelfExclude,
  useUpsertMyLimits,
  type RgSettings as RgSettingsForLimits,
  type SelfExclusion,
  type SelfExclusionType,
} from '@/lib/hooks/use-responsible-gaming';

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2)
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

export default function PlaySettingsPage() {
  const rg = useMyResponsibleGaming();

  if (rg.isLoading) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-32 w-full rounded-[var(--radius-xl)] bg-[var(--color-bg-subtle)]" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-64 w-full rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
          <Shield className="size-3" />
          Tu cuenta
        </span>
        <h1 className="font-display text-[34px] leading-none">Mi cuenta</h1>
      </header>

      <ProfileHero />

      {rg.data?.exclusion && <ExclusionBanner exclusion={rg.data.exclusion} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Columna izquierda */}
        <div className="flex flex-col gap-4">
          <DatosPersonales />
          <UiPreferencesSection />
        </div>
        {/* Columna derecha */}
        <div className="flex flex-col gap-4">
          <SeguridadSection />
          <div className="flex flex-col gap-3">
            <h2 className="px-1 font-display text-[20px]">Juego responsable</h2>
            <LimitsSection
              settings={rg.data?.settings ?? null}
              disabled={!!rg.data?.exclusion}
            />
            {!rg.data?.exclusion && <ExclusionSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Perfil + datos + seguridad
// ──────────────────────────────────────────────────────────────────────

function ProfileHero() {
  const { user } = useAuth();
  const wallet = useMyWallet();
  const vip = useVipTier();

  const name = user?.displayName || user?.username || 'Jugador';
  const initials = initialsFrom(name);
  const TierIcon = vip.tier.icon;
  const saldo =
    wallet.data?.balance != null
      ? `$ ${arsFmt.format(Number(wallet.data.balance))}`
      : '—';
  const twoFa = user?.twoFaEnabled;

  return (
    <section
      className="flex flex-col items-center gap-5 rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6 sm:flex-row"
      style={{
        backgroundImage:
          'radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--color-purple) 18%, transparent) 0%, transparent 55%), var(--color-bg-elevated)',
      }}
    >
      {/* Avatar */}
      <div
        className="grid size-20 shrink-0 place-items-center rounded-[var(--radius-lg)] font-display text-[28px] text-white"
        style={{
          background: 'linear-gradient(135deg, #7b2ff7, #ff3ec9)',
          boxShadow: '0 0 28px -6px rgba(123,47,247,.6)',
        }}
      >
        {initials}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col items-center gap-2 text-center sm:items-start sm:text-left">
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <h2 className="font-display text-[24px] leading-none">{name}</h2>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#1a1206]"
            style={{ background: vip.tier.gradient }}
          >
            <TierIcon className="size-3" />
            VIP {vip.tier.label}
          </span>
        </div>
        <span className="text-[12px] text-[var(--color-fg-muted)]">
          @{user?.username ?? '—'}
          {user?.email ? ` · ${user.email}` : ''}
        </span>
        <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
          <HeroStat label="Saldo" value={saldo} color="var(--color-fg)" />
          <HeroStat
            label="Nivel VIP"
            value={vip.tier.label}
            color="var(--color-gold)"
          />
          <HeroStat
            label="Volumen apostado"
            value={`${Number(vip.volume).toLocaleString('es-AR')} fichas`}
            color="var(--color-accent-text)"
          />
        </div>
      </div>

      {/* Estado */}
      <span
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em]"
        style={{
          color: 'var(--color-success)',
          background: 'color-mix(in srgb, var(--color-success) 14%, transparent)',
        }}
      >
        <Check className="size-3" />
        {twoFa ? 'Verificado' : 'Cuenta activa'}
      </span>
    </section>
  );
}

function HeroStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className="text-[15px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function DatosPersonales() {
  const { user } = useAuth();
  const rows: { label: string; value: string; icon: typeof User }[] = [
    { label: 'Usuario', value: `@${user?.username ?? '—'}`, icon: AtSign },
    { label: 'Nombre', value: user?.displayName || '—', icon: User },
    { label: 'Email', value: user?.email || '—', icon: Mail },
  ];
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <h3 className="mb-4 font-display text-[18px]">Datos personales</h3>
      <ul className="flex flex-col divide-y divide-[var(--color-border)]">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <li
              key={r.label}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <span className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
                <Icon className="size-3.5 text-[var(--color-fg-subtle)]" />
                {r.label}
              </span>
              <span className="truncate text-[13px] text-[var(--color-fg)]">
                {r.value}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SeguridadSection() {
  const { user, logout } = useAuth();
  const twoFa = user?.twoFaEnabled;
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <h3 className="mb-4 font-display text-[18px]">Seguridad</h3>
      <div className="flex flex-col gap-4">
        {/* Estado 2FA (real) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[var(--color-fg)]">
              Verificación en 2 pasos
            </span>
            <span
              className="text-[11px] font-medium"
              style={{
                color: twoFa
                  ? 'var(--color-success)'
                  : 'var(--color-fg-subtle)',
              }}
            >
              {twoFa ? 'Activada' : 'Desactivada'}
            </span>
          </div>
          <ShieldCheck
            className="size-5"
            style={{
              color: twoFa ? 'var(--color-success)' : 'var(--color-fg-subtle)',
            }}
          />
        </div>

        <div className="h-px bg-[var(--color-border)]" />

        {/* Cerrar sesión (real) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[var(--color-fg)]">
              Sesión
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)]">
              Cerrá tu sesión en este dispositivo.
            </span>
          </div>
          <button
            type="button"
            onClick={() => logout('/play/login')}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius)] border border-[color:color-mix(in_srgb,var(--color-danger)_45%,transparent)] px-4 text-[13px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--color-danger)_12%,transparent)]"
          >
            <LogOut className="size-3.5" />
            Cerrar sesión
          </button>
        </div>
      </div>
    </section>
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
  settings: RgSettingsForLimits | null;
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
          Dejá vacío para "sin límite". Los caps se cuentan en fichas.
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
