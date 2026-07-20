/**
 * /play/wheel — Ruleta diaria (rediseño "Neón Milonga", Casino TANGO).
 *
 * Pantalla "Ruleta diaria" del handoff. El chrome lo provee play/layout.tsx.
 *
 * Composición:
 *   - Header: kicker + título.
 *   - 2 columnas: panel de la rueda (SVG multicolor + hub TANGO + "Girar
 *     gratis") | panel lateral (Cómo funciona + Premios posibles).
 *   - "Últimos giros": historial de rewards.
 *
 * Función PRESERVADA (toda la lógica interactiva intacta):
 *   - useActivePromotions('daily_wheel') → rueda + config.segments.
 *   - useMyWheelRewards → historial + check `spunToday`.
 *   - useSpinWheel → POST /spin, animación de rotación, modal de premio
 *     con confetti + sonido.
 *   - 409 PROMOTION_ALREADY_CLAIMED / FUNDER_INSUFFICIENT_BALANCE → toast.
 */

'use client';

import { Bell, Coins, Gift, RefreshCw, Repeat, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import { confettiBurst, confettiJackpot } from '@/lib/confetti';
import { soundClaim, soundJackpot } from '@/lib/sounds';
import {
  useActivePromotions,
  useMyWheelRewards,
  useSpinWheel,
  todayUtcAnchor,
  type PlayerPromotion,
  type SpinResponse,
  type WheelConfig,
  type WheelPrize,
  type WheelReward,
  type WheelSegment,
} from '@/lib/hooks/use-player-promotions';
import { cn } from '@/lib/cn';

const WHEEL_SIZE = 360;
const WHEEL_RADIUS = WHEEL_SIZE / 2 - 12;
const CENTER = WHEEL_SIZE / 2;

// Paleta neón vibrante para los segmentos (multicolor como el handoff).
const SEGMENT_PALETTE = [
  '#ff2ea0', // rosa neón
  '#ff3ec9', // magenta
  '#ff7a18', // naranja
  '#39d353', // verde
  '#9b4dff', // violeta
  '#00e5ff', // cian
  '#f0c46a', // oro
  '#e0208a', // rosa profundo
];

export default function PlayWheelPage() {
  const promos = useActivePromotions('daily_wheel');
  const wheel = useMemo(() => promos.data?.data?.[0] ?? null, [promos.data]);

  if (promos.isLoading) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader />
        <Skeleton className="mx-auto h-[360px] w-[360px] rounded-full bg-[var(--color-bg-subtle)]" />
      </div>
    );
  }

  if (promos.isError) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader />
        <EmptyState
          hint="wheel"
          label="No se pudo cargar la rueda."
          action={
            <Button variant="secondary" size="sm" onClick={() => promos.refetch()}>
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }

  if (!wheel) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader />
        <EmptyState
          hint="wheel"
          label="No hay rueda activa en este momento. Volvé pronto."
        />
      </div>
    );
  }

  return <WheelExperience wheel={wheel} />;
}

function WheelExperience({ wheel }: { wheel: PlayerPromotion }) {
  const config = wheel.config as Partial<WheelConfig>;
  const segments = useMemo(() => config?.segments ?? [], [config]);

  const rewards = useMyWheelRewards(wheel.id, { limit: 30 });
  const todayAnchor = todayUtcAnchor();

  const spunToday = useMemo(() => {
    const list = rewards.data?.data ?? [];
    return list.find((r) => {
      const anchorFromMeta =
        typeof r.metadata?.dayAnchor === 'string' ? r.metadata.dayAnchor : null;
      if (anchorFromMeta) return anchorFromMeta === todayAnchor;
      const d = new Date(r.grantedAt);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}` === todayAnchor;
    });
  }, [rewards.data, todayAnchor]);

  const spin = useSpinWheel(wheel.id);

  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [revealed, setRevealed] = useState<SpinResponse | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  async function handleSpin() {
    if (spinning || spunToday) return;
    setSpinning(true);
    try {
      const result = await spin.mutateAsync();
      const winningIndex = segments.findIndex((s) => s.id === result.segmentId);
      if (winningIndex < 0) {
        setRotation((r) => r + 360 * 3);
        setRevealed(result);
        setSpinning(false);
        return;
      }
      const segmentAngle = 360 / segments.length;
      const targetBase = -(winningIndex * segmentAngle) - segmentAngle / 2;
      const extraSpins = 5 * 360;
      setRotation((r) => {
        const normalized = r % 360;
        const delta = ((targetBase - normalized) % 360) - 360;
        return r + delta - extraSpins;
      });
      timeoutRef.current = setTimeout(() => {
        setRevealed(result);
        setSpinning(false);
      }, 4200);
    } catch (err) {
      setSpinning(false);
      if (isApiError(err) && err.code === 'PROMOTION_ALREADY_CLAIMED') {
        toast.info('Ya giraste hoy. Volvé mañana.');
      } else if (isApiError(err) && err.code === 'FUNDER_INSUFFICIENT_BALANCE') {
        toast.error('La rueda está temporalmente sin fondos. Avisale al cajero.');
      } else if (isApiError(err)) {
        toast.error(err.message || 'No se pudo girar la rueda.');
      } else {
        toast.error('Error de conexión.');
      }
    }
  }

  const rewardsList = rewards.data?.data ?? [];

  return (
    <>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader />

        {/* 2 columnas: rueda | paneles laterales */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Panel de la rueda */}
          <div className="flex flex-col items-center gap-6 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-6 sm:p-8">
            <div
              className="relative"
              style={{ width: 'min(100%, 360px)', aspectRatio: '1 / 1' }}
            >
              <WheelSvg segments={segments} rotation={rotation} spinning={spinning} />
              {/* Hub TANGO — fuera del SVG rotante para quedar siempre derecho */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className="grid size-[68px] place-items-center rounded-full border-2 border-[var(--color-accent)] bg-[var(--color-bg)] text-[13px] font-bold tracking-[0.06em] text-[var(--color-fg)]"
                  style={{ boxShadow: '0 0 18px -4px var(--color-accent-glow)' }}
                >
                  TA<span className="text-[var(--color-accent)]">N</span>GO
                </div>
              </div>
            </div>

            {/* Girar gratis — gradiente violeta→magenta */}
            <button
              type="button"
              onClick={handleSpin}
              disabled={spinning || !!spunToday || segments.length === 0}
              className="inline-flex h-12 items-center gap-2 rounded-[var(--radius)] px-8 text-[15px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7b2ff7, #ff3ec9)' }}
            >
              {spinning ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                  Girando…
                </>
              ) : spunToday ? (
                <>
                  <Repeat className="size-4" />
                  Ya giraste hoy
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Girar gratis
                </>
              )}
            </button>
          </div>

          {/* Paneles laterales */}
          <div className="flex flex-col gap-4">
            <SidePanel title="Cómo funciona">
              <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
                {spunToday ? (
                  <>
                    Ya giraste hoy. Volvé mañana después de las 00:00 UTC para tu
                    próximo giro gratis.
                  </>
                ) : (
                  <>
                    Tenés <span className="text-[var(--color-fg)]">1 giro gratis</span>{' '}
                    cada 24 hs. Girá y ganás fichas, giros o un bono. El premio se
                    acredita al instante.
                  </>
                )}
              </p>
            </SidePanel>

            <SidePanel title="Premios posibles">
              <ul className="flex flex-col gap-2">
                {segments.map((seg, i) => (
                  <li key={seg.id ?? i} className="flex items-center gap-2.5">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        background: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
                        boxShadow: `0 0 8px -1px ${SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]}`,
                      }}
                    />
                    <span className="truncate text-[13px] text-[var(--color-fg)]">
                      {seg.label ?? formatPrizeShort(seg.prize)}
                    </span>
                  </li>
                ))}
              </ul>
            </SidePanel>
          </div>
        </div>

        {/* Últimos giros */}
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[24px]">Últimos giros</h2>
          {rewardsList.length === 0 ? (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-6">
              <EmptyState hint="wheel" label="Todavía no giraste la rueda." />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
              {rewardsList.map((r, i) => (
                <RewardRow key={r.id} reward={r} tone={SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]!} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {revealed && (
        <PrizeRevealModal spin={revealed} onClose={() => setRevealed(null)} />
      )}
    </>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
        <Sparkles className="size-3" />
        Recompensas · Ruleta diaria
      </span>
      <h1 className="font-display text-[34px] leading-none">Ruleta diaria</h1>
    </header>
  );
}

function SidePanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <span className="mb-3 block text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
        {title}
      </span>
      {children}
    </div>
  );
}

function RewardRow({ reward, tone }: { reward: WheelReward; tone: string }) {
  const Icon = iconForPrize(reward.prize.kind);
  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)]"
        style={{
          background: `color-mix(in srgb, ${tone} 22%, transparent)`,
          color: tone,
          boxShadow: `0 0 12px -4px ${tone}`,
        }}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium text-[var(--color-fg)]">
          {formatPrizeShort(reward.prize)}
        </span>
        <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
          {formatWhen(reward.grantedAt)}
        </span>
      </div>
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-success)]">
        Acreditado
      </span>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SVG de la rueda
// ──────────────────────────────────────────────────────────────────────

function WheelSvg({
  segments,
  rotation,
  spinning,
}: {
  segments: WheelSegment[];
  rotation: number;
  spinning: boolean;
}) {
  const N = segments.length;
  if (N === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-full border border-dashed border-[var(--color-border-strong)] text-[12px] text-[var(--color-fg-subtle)]">
        Sin segmentos configurados
      </div>
    );
  }
  const segmentAngle = 360 / N;

  return (
    <div className="relative h-full w-full">
      {/* Pointer fijo arriba */}
      <svg
        className="absolute left-1/2 -top-1 z-10 -translate-x-1/2"
        width="28"
        height="36"
        viewBox="0 0 28 36"
        aria-hidden
      >
        <polygon
          points="14,32 2,4 26,4"
          fill="var(--color-accent-text)"
          stroke="var(--color-bg)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>

      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
        preserveAspectRatio="xMidYMid meet"
        className="drop-shadow-[0_0_28px_rgba(255,46,160,0.25)]"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning
            ? 'transform 4s cubic-bezier(0.17, 0.67, 0.18, 1)'
            : 'none',
        }}
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={WHEEL_RADIUS + 4}
          fill="var(--color-bg-elevated)"
          stroke="var(--color-border-strong)"
          strokeWidth="2"
        />
        {segments.map((seg, i) => {
          const path = segmentPath(i, segmentAngle, WHEEL_RADIUS);
          const color = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length];
          const midAngleRad = ((i + 0.5) * segmentAngle - 90) * (Math.PI / 180);
          const lx = CENTER + WHEEL_RADIUS * 0.64 * Math.cos(midAngleRad);
          const ly = CENTER + WHEEL_RADIUS * 0.64 * Math.sin(midAngleRad);
          const labelRotation = (i + 0.5) * segmentAngle;
          const label = seg.label ?? formatPrizeShort(seg.prize);
          return (
            <g key={seg.id ?? i}>
              <path d={path} fill={color} stroke="var(--color-bg)" strokeWidth="2" />
              <text
                x={lx}
                y={ly}
                fill="#0a0008"
                fontSize="13"
                fontFamily="system-ui, sans-serif"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${labelRotation}, ${lx}, ${ly})`}
                style={{ pointerEvents: 'none' }}
              >
                {label}
              </text>
            </g>
          );
        })}
        {/* Hub interno (el texto TANGO va por encima, fuera del SVG) */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r="34"
          fill="var(--color-bg)"
          stroke="var(--color-accent)"
          strokeWidth="3"
        />
      </svg>
    </div>
  );
}

function segmentPath(index: number, segmentAngle: number, radius: number): string {
  const startRad = (index * segmentAngle - 90) * (Math.PI / 180);
  const endRad = ((index + 1) * segmentAngle - 90) * (Math.PI / 180);
  const sx = CENTER + radius * Math.cos(startRad);
  const sy = CENTER + radius * Math.sin(startRad);
  const ex = CENTER + radius * Math.cos(endRad);
  const ey = CENTER + radius * Math.sin(endRad);
  const largeArc = segmentAngle > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${sx} ${sy} A ${radius} ${radius} 0 ${largeArc} 1 ${ex} ${ey} Z`;
}

function formatPrizeShort(prize: WheelPrize): string {
  if (prize.kind === 'chips') return `${prize.amount ?? 0} fichas`;
  if (prize.kind === 'try_again') return 'Probá de nuevo';
  if (prize.kind === 'bonus') return 'Bono';
  if (prize.kind === 'free_spins') return `${prize.amount ?? 0} giros gratis`;
  return prize.kind;
}

function formatWhen(iso: string | Date): string {
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (sameDay) return `Hoy · ${time}`;
    const date = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    return `${date} · ${time}`;
  } catch {
    return String(iso);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Modal del premio (preservado)
// ──────────────────────────────────────────────────────────────────────

function PrizeRevealModal({
  spin,
  onClose,
}: {
  spin: SpinResponse;
  onClose: () => void;
}) {
  const isTryAgain = spin.prize.kind === 'try_again';
  const Icon = iconForPrize(spin.prize.kind);

  useEffect(() => {
    if (isTryAgain) return;
    const amount = spin.prize.kind === 'chips' ? Number(spin.prize.amount) : 0;
    const isBig = spin.prize.kind !== 'chips' || amount >= 5000;
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

        {!isTryAgain && (
          <p className="text-center text-[13px] text-[var(--color-fg-muted)]">
            {spin.prize.kind === 'chips'
              ? 'Ya te lo acreditamos en tu wallet.'
              : spin.prize.kind === 'bonus'
                ? 'Tu bono ya está activo. Revisalo en Bonos.'
                : spin.prize.kind === 'free_spins'
                  ? 'Tus giros gratis están listos.'
                  : 'Disfrutalo.'}
          </p>
        )}

        <Button variant="primary" size="md" onClick={onClose}>
          Listo
        </Button>
      </div>
    </div>
  );
}

function iconForPrize(kind: WheelPrize['kind']) {
  if (kind === 'chips') return Coins;
  if (kind === 'bonus') return Gift;
  if (kind === 'free_spins') return RefreshCw;
  if (kind === 'try_again') return Repeat;
  return Bell;
}
