/**
 * /play/wheel — Ruleta diaria (frontend del Sprint "ruleta", docs/27).
 *
 * Recreación de la pantalla del handoff (estética: rueda neón de 12 gajos,
 * hub con puntero, anillo de luces) sobre las mecánicas reales del doc:
 *
 *   - 1 giro por día en la ZONA del casino (`config.timezone`, no UTC).
 *   - El premio sale de un sobre cerrado: ANTES de girar se muestra la huella
 *     (`useWheelCommitment`); al terminar se revela la semilla (`verificacion`
 *     del spin) y el navegador la recomprueba por WebCrypto (lib/wheel/fairness).
 *   - El historial muestra el estado REAL de entrega (entregado / pendiente /
 *     falló acreditación), no "acreditado" siempre.
 *   - Rotación por rAF (lib/wheel/rotation): gira mientras espera el POST y
 *     aterriza exacto en el gajo ganador.
 *
 * Copy en español de negocio: nunca "chips", "fichas" sí.
 */

'use client';

import { Bell, CheckCircle2, Coins, Gift, RefreshCw, Repeat, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { WheelSvg } from '@/components/player/wheel/wheel-svg';
import { isApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { confettiBurst, confettiJackpot } from '@/lib/confetti';
import {
  CASINO_TIMEZONE_DEFAULT,
  dayAnchorInZone,
  useActivePromotions,
  useMyWheelRewards,
  useSpinWheel,
  useWheelCommitment,
  type PlayerPromotion,
  type SpinResponse,
  type WheelConfig,
  type WheelPrize,
  type WheelReward,
} from '@/lib/hooks/use-player-promotions';
import { soundClaim, soundJackpot } from '@/lib/sounds';
import { remainingUntilNextAnchor } from '@/lib/wheel/day-anchor';
import { supportsWebCrypto, verifyReveal, type SpinChecks } from '@/lib/wheel/fairness';
import { WheelRotation } from '@/lib/wheel/rotation';

export default function PlayWheelPage() {
  const promos = useActivePromotions('daily_wheel');
  const wheel = useMemo(() => promos.data?.data?.[0] ?? null, [promos.data]);

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader name={wheel?.name} />
      {promos.isLoading ? (
        <Skeleton className="mx-auto h-[380px] w-full max-w-[560px] rounded-full bg-[var(--color-bg-subtle)]" />
      ) : promos.isError ? (
        <EmptyState
          label="Ups, no pudimos cargar la rueda."
          description="Esperá unos segundos y probá de nuevo."
          action={
            <Button variant="secondary" size="sm" onClick={() => void promos.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : !wheel ? (
        <EmptyState
          label="Todavía no hay rueda activa."
          description="Está atento: cuando la rueda esté disponible, vas a poder girarla gratis."
        />
      ) : (
        <WheelExperience wheel={wheel} />
      )}
    </div>
  );
}

function WheelExperience({ wheel }: { wheel: PlayerPromotion }) {
  const config = wheel.config as WheelConfig;
  const segments = config?.segments ?? [];
  const timezone = config?.timezone || CASINO_TIMEZONE_DEFAULT;

  const commitment = useWheelCommitment(wheel.id);
  const rewards = useMyWheelRewards(wheel.id, { limit: 30 });
  const spin = useSpinWheel(wheel.id);

  const fallbackAnchor = dayAnchorInZone(new Date(), timezone);
  const todayAnchor = commitment.data?.dayAnchor ?? fallbackAnchor;
  const rewardsList = rewards.data?.data ?? [];
  const todayReward = rewardsList.find(
    (r) => r.metadata?.dayAnchor === todayAnchor,
  ) ?? null;
  const spunToday = todayReward !== null;

  // ── Rotación (rAF) ────────────────────────────────────────────────────
  const animator = useRef<WheelRotation | null>(null);
  const [wheelGroup, setWheelGroup] = useState<SVGGElement | null>(null);
  useEffect(() => {
    const instance = new WheelRotation();
    instance.attach(wheelGroup);
    animator.current = instance;
    return () => instance.detach();
  }, [wheelGroup]);

  const [spinning, setSpinning] = useState(false);
  const [reveal, setReveal] = useState<SpinResponse | null>(null);
  const [checks, setChecks] = useState<SpinChecks | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function runChecks(
    result: SpinResponse,
    segmentIndex: number,
  ): Promise<void> {
    const v = result.verificacion;
    // El segmento o la semilla no vinieron: no hay nada para calcular.
    if (!v || !v.serverSeed || !v.clientSeed || !v.serverSeedHash) return;
    if (!supportsWebCrypto()) return;
    setVerifying(true);
    try {
      const c = await verifyReveal({
        serverSeed: v.serverSeed,
        serverSeedHash: v.serverSeedHash,
        clientSeed: v.clientSeed,
        dayAnchor: todayAnchor,
        expectedSegmentIndex: segmentIndex,
        segments,
      });
      setChecks(c);
    } catch {
      // No romper la UX de la entrega: la verificación es un plus.
    } finally {
      setVerifying(false);
    }
  }

  const canSpin =
    !!commitment.data &&
    segments.length > 0 &&
    !spinning &&
    !spunToday &&
    !spin.isPending;

  async function handleSpin(): Promise<void> {
    if (!canSpin) return;
    setSpinning(true);
    setReveal(null);
    setChecks(null);
    animator.current?.idle();
    try {
      const result = await spin.mutateAsync();
      const index = segments.findIndex((s) => s.id === result.segmentId);
      if (index < 0) {
        animator.current?.stop();
        setReveal(result);
        setSpinning(false);
        return;
      }
      await animator.current?.land(index, segments.length, {
        durationMs: 4200,
        minTurns: 6,
      });
      setReveal(result);
      setSpinning(false);
      void runChecks(result, index);
    } catch (err) {
      animator.current?.stop();
      setSpinning(false);
      mapSpinError(err);
    }
  }

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remainingMs = remainingUntilNextAnchor(nowTick, timezone, nowTick);

  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Rueda */}
        <section className="relative flex flex-col items-center gap-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-6 sm:p-8">
          {segments.length === 0 ? (
            <div className="flex h-[360px] w-full items-center justify-center rounded-full border border-dashed border-[var(--color-border-strong)] text-[12px] text-[var(--color-fg-subtle)]">
              Sin segmentos configurados
            </div>
          ) : (
            <WheelSvg
              segments={segments}
              groupRef={setWheelGroup}
              className="w-full max-w-[560px] drop-shadow-[0_0_40px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
            />
          )}

          {/* Premios posibles — chips reales de la config */}
          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            {segments.map((seg) => (
              <span
                key={seg.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-fg-muted)]"
              >
                <span className="size-1.5 rounded-full bg-[var(--color-gold)]" />
                {seg.label ?? formatPrizeShort(seg.prize)}
              </span>
            ))}
          </div>
        </section>

        {/* Lateral */}
        <div className="flex flex-col gap-5">
          <HoyCard
            canSpin={canSpin}
            spinning={spinning}
            commitmentLoading={commitment.isLoading}
            spunToday={spunToday}
            todayReward={todayReward}
            remainingMs={remainingMs}
            onSpin={() => void handleSpin()}
          />
          <VerificacionCard
            commitment={commitment.data ?? null}
            commitmentLoading={commitment.isLoading}
            commitmentError={commitment.isError}
            reveal={reveal}
            checks={checks}
            verifying={verifying}
          />
          <ComoFunciona />
        </div>
      </div>

      {/* Historial */}
      <HistorySection rewards={rewardsList} timezone={timezone} />

      {reveal && (
        <PrizeRevealModal
          spin={reveal}
          checks={checks}
          verifying={verifying}
          onClose={() => setReveal(null)}
        />
      )}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Hoy — estado del giro de hoy                                          */
/* ────────────────────────────────────────────────────────────────────── */

function HoyCard({
  canSpin,
  spinning,
  commitmentLoading,
  spunToday,
  todayReward,
  remainingMs,
  onSpin,
}: {
  canSpin: boolean;
  spinning: boolean;
  commitmentLoading: boolean;
  spunToday: boolean;
  todayReward: WheelReward | null;
  remainingMs: number;
  onSpin: () => void;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
          Hoy
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-fg-muted)]">
          <span className="size-1.5 rounded-full bg-[var(--color-gold)]" />
          1 giro gratis / día
        </span>
      </div>

      {spinning ? (
        <button
          type="button"
          disabled
          className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius)] text-[15px] font-semibold text-[var(--color-accent-fg)] transition-opacity disabled:opacity-80"
          style={{ background: 'var(--gradient-accent)' }}
        >
          <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          Girando…
        </button>
      ) : spunToday ? (
        <div className="flex flex-col gap-3">
          <div
            className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3.5"
            style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-gold) 12%, transparent)' }}
          >
            <CheckCircle2 className="size-5 shrink-0 text-[var(--color-gold)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[var(--color-fg)]">
                {todayReward
                  ? formatPrizeShort(todayReward.prize)
                  : 'Ya giraste hoy'}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
              Próximo giro en
            </span>
            <span className="font-mono text-[22px] font-medium tabular-nums text-[var(--color-accent-text)]">
              {formatCountdown(remainingMs)}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onSpin}
            disabled={!canSpin}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius)] text-[16px] font-bold uppercase tracking-[0.1em] text-[var(--color-accent-fg)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background: 'var(--gradient-accent)',
              boxShadow: canSpin
                ? '0 0 22px color-mix(in srgb, var(--color-accent) 40%, transparent)'
                : 'none',
            }}
          >
            <Sparkles className="size-4" />
            {commitmentLoading ? 'Preparando el sobre…' : 'Girar'}
          </button>
          {!commitmentLoading && (
            <p className="text-center text-[11px] text-[var(--color-fg-subtle)]">
              Se sella la semilla de hoy antes de girar.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Sobre cerrado / verificación (docs/27 §8)                              */
/* ────────────────────────────────────────────────────────────────────── */

function VerificacionCard({
  commitment,
  commitmentLoading,
  commitmentError,
  reveal,
  checks,
  verifying,
}: {
  commitment: { serverSeedHash: string; clientSeed: string; dayAnchor: string } | null;
  commitmentLoading: boolean;
  commitmentError: boolean;
  reveal: SpinResponse | null;
  checks: SpinChecks | null;
  verifying: boolean;
}) {
  const v = reveal?.verificacion;
  const open = !!v?.serverSeed;

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="size-4 text-[var(--color-accent-text)]" />
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
          Sorteo verificable
        </span>
      </div>

      {commitmentLoading ? (
        <p className="text-[12px] text-[var(--color-fg-subtle)]">
          Sellando el sobre de hoy…
        </p>
      ) : commitmentError || !commitment ? (
        <p className="text-[12px] leading-relaxed text-[var(--color-fg-subtle)]">
          No pudimos sellar el sobre. El giro igual puede funcionar, pero por
          ahora no vas a poder verificar el resultado.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[11px] text-[var(--color-fg-muted)]">Huella antes de girar</span>
            <code className="break-all font-mono text-[11px] tabular-nums text-[var(--color-fg)]">
              {shortHash(commitment.serverSeedHash)}
            </code>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-[11px] text-[var(--color-fg-muted)]">Semilla del jugador</span>
            <code className="break-all font-mono text-[11px] text-[var(--color-fg)]">
              {commitment.clientSeed}
            </code>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-[11px] text-[var(--color-fg-muted)]">Día (hora del casino)</span>
            <code className="font-mono text-[11px] tabular-nums text-[var(--color-fg)]">
              {commitment.dayAnchor}
            </code>
          </div>

          <details className="mt-1 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] p-2.5">
            <summary className="cursor-pointer text-[11px] font-medium text-[var(--color-accent-text)]">
              ¿Cómo se verifica?
            </summary>
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-4 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
              <li>
                Antes de girar se publica la huella de la semilla (un sobre
                sellado).
              </li>
              <li>
                Al terminar se revela la semilla y el navegador comprueba que
                produce esa misma huella y el gajo que salió.
              </li>
            </ol>
          </details>
        </div>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--color-border)] pt-3">
          <span className="text-[11px] text-[var(--color-fg-muted)]">Semilla revelada</span>
          <code className="break-all rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] p-2 font-mono text-[11px] text-[var(--color-fg)]">
            {v?.serverSeed}
          </code>
          {verifying ? (
            <p className="text-[11px] text-[var(--color-fg-subtle)]">Verificando en tu navegador…</p>
          ) : checks ? (
            <div className="flex flex-col gap-1">
              <CheckRow ok={checks.fingerprint}>
                La semilla produce la huella publicada antes de girar
              </CheckRow>
              <CheckRow ok={checks.segment}>
                Esa semilla da exactamente el gajo que te salió
              </CheckRow>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--color-fg-subtle)]">
              La verificación automática no está disponible en este dispositivo.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CheckRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--color-fg-muted)]">
      <span className={cn('mt-px font-bold', ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')}>
        {ok ? '✓' : '✗'}
      </span>
      {children}
    </p>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Cómo funciona (docs/27 §10)                                            */
/* ────────────────────────────────────────────────────────────────────── */

function ComoFunciona() {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <span className="mb-3 block text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
        Cómo funciona
      </span>
      <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
        <li>· Un giro gratis por día. Se renueva a la medianoche del casino.</li>
        <li>
          · El premio se acredita como bono jugable: no se retira directo y
          vence si no lo usás. Revisá el plazo en tus bonos.
        </li>
        <li>· «Probá de nuevo» no suma ni descuenta.</li>
        <li>
          · Quienes estén autoexcluidos o fuera de la red del operador no
          pueden participar.
        </li>
      </ul>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Últimos giros — con estado real de entrega                            */
/* ────────────────────────────────────────────────────────────────────── */

function HistorySection({
  rewards,
  timezone,
}: {
  rewards: WheelReward[];
  timezone: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[22px] leading-none text-[var(--color-fg)]">
        Tus giros
      </h2>
      {rewards.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-6">
          <EmptyState
            label="Todavía no giraste la rueda."
            description="Girá arriba y ganá premios."
          />
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          {rewards.map((r) => (
            <RewardRow key={r.id} reward={r} timezone={timezone} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RewardRow({ reward, timezone }: { reward: WheelReward; timezone: string }) {
  const Icon = iconForPrize(reward.prize.kind);
  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"
        style={{ boxShadow: '0 0 12px -4px var(--color-accent)' }}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium text-[var(--color-fg)]">
          {formatPrizeShort(reward.prize)}
        </span>
        <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
          {formatWhen(reward.grantedAt, timezone)}
        </span>
      </div>
      <DeliveryChip reward={reward} />
    </li>
  );
}

function DeliveryChip({ reward }: { reward: WheelReward }) {
  if (reward.deliveredAt) {
    return (
      <span className="shrink-0 rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-success)]">
        Entregado
      </span>
    );
  }
  if (reward.deliveryError) {
    return (
      <span
        title={reward.deliveryError}
        className="shrink-0 rounded-full border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-gold)]"
      >
        Falló acreditación
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
      Pendiente
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Modal del premio                                                       */
/* ────────────────────────────────────────────────────────────────────── */

function PrizeRevealModal({
  spin,
  checks,
  verifying,
  onClose,
}: {
  spin: SpinResponse;
  checks: SpinChecks | null;
  verifying: boolean;
  onClose: () => void;
}) {
  const isTryAgain = spin.prize.kind === 'try_again';
  const Icon = iconForPrize(spin.prize.kind);
  const verified = checks?.fingerprint && checks?.segment;

  useEffect(() => {
    if (isTryAgain) return;
    const amount = Number(spin.prize.amount ?? 0);
    const isBig = spin.prize.kind !== 'try_again' && amount >= 5000;
    if (isBig) {
      confettiJackpot();
      soundJackpot();
    } else {
      confettiBurst();
      soundClaim();
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="surface-glass relative flex w-full max-w-md flex-col items-center gap-4 rounded-[var(--radius-xl)] p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-3 top-3 grid size-7 place-items-center rounded-full text-[var(--color-fg-subtle)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]"
        >
          <X className="size-3.5" />
        </button>

        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-muted)]">
          {isTryAgain ? 'Buen intento' : '¡Ganaste!'}
        </span>

        <div
          className={cn(
            'grid size-20 place-items-center rounded-full border-2',
            isTryAgain
              ? 'border-[var(--color-border-strong)] text-[var(--color-fg-subtle)]'
              : 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]',
          )}
        >
          <Icon className="size-10" />
        </div>

        <h2 className="font-display text-center text-[2rem] leading-none">
          {spin.segmentLabel ?? formatPrizeShort(spin.prize)}
        </h2>

        <p className="text-center text-[13px] text-[var(--color-fg-muted)]">
          {isTryAgain
            ? 'No aflojes: mañana hay otra ruleta.'
            : 'El premio se acredita como bono y ya lo podés jugar. Revisalo en Bonos.'}
        </p>

        {verified && (
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-success)]">
            <CheckCircle2 className="size-3.5" />
            Sobre verificado: la semilla revelada dio este gajo
          </p>
        )}
        {verifying && (
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            Verificando el sorteo…
          </p>
        )}

        <Button variant="primary" size="md" onClick={onClose}>
          Listo
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                */
/* ────────────────────────────────────────────────────────────────────── */

function PageHeader({ name }: { name: string | null | undefined }) {
  return (
    <header className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
        <Sparkles className="size-3" />
        Recompensas · Ruleta diaria
      </span>
      <h1 className="font-display text-[34px] leading-none">
        {name ?? 'Ruleta diaria'}
      </h1>
    </header>
  );
}

function formatPrizeShort(prize: WheelPrize): string {
  if (prize.kind === 'chips') return `${prize.amount ?? 0} fichas`;
  if (prize.kind === 'try_again') return 'Probá de nuevo';
  if (prize.kind === 'bonus') return 'Bono';
  if (prize.kind === 'free_spins') return `${prize.amount ?? 0} tiradas`;
  return prize.kind;
}

function formatWhen(iso: string, timezone: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      dayAnchorInZone(d, timezone) === dayAnchorInZone(now, timezone);
    const time = d.toLocaleTimeString('es-AR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    if (sameDay) return `Hoy · ${time}`;
    const date = d.toLocaleDateString('es-AR', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
    });
    return `${date} · ${time}`;
  } catch {
    return String(iso);
  }
}

function shortHash(hash: string): string {
  if (hash.length <= 24) return hash;
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function iconForPrize(kind: WheelPrize['kind']) {
  if (kind === 'chips') return Coins;
  if (kind === 'bonus') return Gift;
  if (kind === 'free_spins') return RefreshCw;
  if (kind === 'try_again') return Repeat;
  return Bell;
}

function mapSpinError(err: unknown): void {
  if (isApiError(err)) {
    if (err.code === 'PROMOTION_ALREADY_CLAIMED') {
      toast.info('Ya giraste hoy. Volvé mañana.');
    } else if (err.code === 'FUNDER_INSUFFICIENT_BALANCE') {
      toast.error('La rueda está temporalmente sin fondos. Avisale al cajero.');
    } else if (err.code === 'WHEEL_PRIZE_NOT_DELIVERED') {
      toast.error(
        'Ganaste, pero no pudimos acreditarte el premio. Ya quedó registrado y lo vamos a resolver.',
      );
    } else if (err.code?.startsWith('WHEEL_')) {
      toast.error(err.message || 'No se pudo girar la ruleta.');
    } else {
      toast.error(err.message || 'No se pudo girar la ruleta.');
    }
    return;
  }
  toast.error('Error de conexión.');
}