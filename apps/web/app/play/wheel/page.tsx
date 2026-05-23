/**
 * /play/wheel — Daily Wheel del jugador.
 *
 * Composición:
 *   - Discovery: useActivePromotions('daily_wheel') → si vacío, EmptyState.
 *     Si múltiples, agarra el primero (MVP — selector emerge si se justifica).
 *   - SVG de la rueda con N segmentos según `config.segments`. Pointer
 *     fijo arriba, rueda rotando bajo el pointer.
 *   - Botón "Girar" — disabled si:
 *     - ya hay reward con `dayAnchor === today UTC` (ya jugó hoy).
 *     - mutation pending.
 *   - Animación: CSS `transform: rotate(Xdeg)` + `transition`. Cálculo:
 *     5 vueltas + ángulo del centro del segmento ganador bajo el pointer.
 *   - Al terminar la animación: modal con el premio.
 *   - 409 PROMOTION_ALREADY_CLAIMED del backend → toast amigable.
 *
 * Backend:
 *   - GET /tenant/promotions/active?type=daily_wheel  (nuevo, Sprint 27)
 *   - POST /tenant/promotions/:id/spin
 *   - GET /tenant/promotions/:id/my-rewards
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
import {
  useActivePromotions,
  useMyWheelRewards,
  useSpinWheel,
  todayUtcAnchor,
  type PlayerPromotion,
  type SpinResponse,
  type WheelConfig,
  type WheelPrize,
  type WheelSegment,
} from '@/lib/hooks/use-player-promotions';
import { cn } from '@/lib/cn';

const WHEEL_SIZE = 360;
const WHEEL_RADIUS = WHEEL_SIZE / 2 - 12; // padding for stroke
const CENTER = WHEEL_SIZE / 2;

// Paleta alternada para distinguir segmentos visualmente. Si hay más
// segmentos que colores, ciclamos.
const SEGMENT_PALETTE = [
  'var(--color-accent)',
  '#2d2d33',
  '#4a4a52',
  '#1f1f24',
  '#5a3d3d',
  '#3d4a5a',
  '#3d5a3d',
  '#5a3d5a',
];

export default function PlayWheelPage() {
  const promos = useActivePromotions('daily_wheel');
  const wheel = useMemo(() => promos.data?.data?.[0] ?? null, [promos.data]);

  if (promos.isLoading) {
    return (
      <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Skeleton className="h-12 w-64 mb-8 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-[360px] w-[360px] mx-auto rounded-full bg-[var(--color-bg-subtle)]" />
      </div>
    );
  }

  if (promos.isError) {
    return (
      <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
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
      <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <PageHeader />
        <div className="mt-10">
          <EmptyState
            hint="wheel"
            label="No hay rueda activa en este momento. Volvé pronto."
          />
        </div>
      </div>
    );
  }

  return <WheelExperience wheel={wheel} />;
}

// ──────────────────────────────────────────────────────────────────────
// Experiencia central
// ──────────────────────────────────────────────────────────────────────

function WheelExperience({ wheel }: { wheel: PlayerPromotion }) {
  const config = wheel.config as Partial<WheelConfig>;
  const segments = useMemo(() => config?.segments ?? [], [config]);

  const rewards = useMyWheelRewards(wheel.id, { limit: 30 });
  const todayAnchor = todayUtcAnchor();

  /**
   * Spun-today check. El backend trackea el `dayAnchor` UTC en
   * metadata.dayAnchor. Si hay reward con ese anchor, ya jugó hoy.
   * Fallback: si metadata no trae dayAnchor (caso edge legacy), comparar
   * `grantedAt` con today UTC.
   */
  const spunToday = useMemo(() => {
    const list = rewards.data?.data ?? [];
    return list.find((r) => {
      const anchorFromMeta =
        typeof r.metadata?.dayAnchor === 'string'
          ? r.metadata.dayAnchor
          : null;
      if (anchorFromMeta) return anchorFromMeta === todayAnchor;
      const d = new Date(r.grantedAt);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}` === todayAnchor;
    });
  }, [rewards.data, todayAnchor]);

  const spin = useSpinWheel(wheel.id);

  /**
   * Rotación actual aplicada al SVG. Por default 0 (segmento 0 en el top).
   * Cuando el player clickea girar:
   *   1. POST /spin → recibe segmentId ganador.
   *   2. Calcular el index del segmento + ángulo target.
   *   3. setRotation(targetAngle + extra spins).
   *   4. Después de la transición (~4s), abrir modal con prize.
   */
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
        // Defensa: si el segmento devuelto no matchea el config visible
        // (edge case: config cambió después del spin, raro), abrir modal
        // sin animación.
        setRotation((r) => r + 360 * 3);
        setRevealed(result);
        setSpinning(false);
        return;
      }
      const segmentAngle = 360 / segments.length;
      // Segmento 0 ya está en el top (offset -90 al render). Para que el
      // segmento `i` quede bajo el pointer, rotamos -i*segAngle (CCW).
      // Para landeo exacto en el centro del segmento, sumamos -segAngle/2.
      // Spins extra (5) para drama.
      const targetBase = -(winningIndex * segmentAngle) - segmentAngle / 2;
      const extraSpins = 5 * 360;
      // Acumulamos sobre `rotation` para que cada giro nuevo siga sumando
      // (evita "reset" visual entre tiradas).
      setRotation((r) => {
        const normalized = r % 360;
        const delta = ((targetBase - normalized) % 360) - 360; // siempre CCW
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

  return (
    <>
      <div className="max-w-[800px] mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col items-center gap-8">
        <PageHeader />

        <p className="text-sm text-[var(--color-fg-muted)] text-center max-w-md">
          {wheel.name}
          {spunToday ? (
            <>
              {' · '}
              <span className="text-[var(--color-fg)]">
                Ya giraste hoy — volvé mañana después de las 00:00 UTC.
              </span>
            </>
          ) : (
            <>
              {' · '}
              <span className="text-[var(--color-fg)]">
                Una tirada por día. ¡Suerte!
              </span>
            </>
          )}
        </p>

        {/* Mobile-first: wheel scales con vw para no overflowear. */}
        <div className="w-full flex items-center justify-center px-2">
          <div className="relative" style={{ width: 'min(100%, 360px)', aspectRatio: '1 / 1' }}>
            <WheelSvg
              segments={segments}
              rotation={rotation}
              spinning={spinning}
            />
          </div>
        </div>

        <Button
          variant="primary"
          size="lg"
          onClick={handleSpin}
          disabled={spinning || !!spunToday || segments.length === 0}
        >
          {spinning ? (
            <>
              <span className="size-4 border-2 border-current border-r-transparent animate-spin rounded-full" />
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
              Girar
            </>
          )}
        </Button>

        <SegmentLegend segments={segments} />
      </div>

      {revealed && (
        <PrizeRevealModal
          spin={revealed}
          onClose={() => setRevealed(null)}
        />
      )}
    </>
  );
}

function PageHeader() {
  return (
    <header className="flex flex-col gap-2 items-center text-center">
      <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
        <Sparkles className="size-3" />
        Promociones · Daily Wheel
      </span>
      <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
        Rueda diaria
      </h1>
    </header>
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
      <div className="flex items-center justify-center w-[360px] h-[360px] border border-dashed border-[var(--color-border-strong)] text-[var(--color-fg-subtle)] text-[12px]">
        Sin segmentos configurados
      </div>
    );
  }
  const segmentAngle = 360 / N;

  // Sprint 51.11: SVG escala al container via viewBox. El wrapper define
  // el tamaño físico (width % o px). El SVG llena 100%.
  return (
    <div className="relative w-full h-full">
      {/* Pointer fijo arriba */}
      <svg
        className="absolute left-1/2 -translate-x-1/2 -top-1 z-10"
        width="28"
        height="36"
        viewBox="0 0 28 36"
        aria-hidden
      >
        <polygon
          points="14,32 2,4 26,4"
          fill="var(--color-accent)"
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
        className={cn(
          'drop-shadow-[0_0_24px_rgba(0,0,0,0.4)]',
        )}
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning
            ? 'transform 4s cubic-bezier(0.17, 0.67, 0.18, 1)'
            : 'none',
        }}
      >
        {/* Anillo exterior */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={WHEEL_RADIUS + 4}
          fill="var(--color-bg-elevated)"
          stroke="var(--color-border-strong)"
          strokeWidth="2"
        />
        {/* Segmentos */}
        {segments.map((seg, i) => {
          const path = segmentPath(i, segmentAngle, WHEEL_RADIUS);
          const color = SEGMENT_PALETTE[i % SEGMENT_PALETTE.length];
          // Label position: midpoint del segmento a r=0.62.
          const midAngleRad = ((i + 0.5) * segmentAngle - 90) * (Math.PI / 180);
          const lx = CENTER + WHEEL_RADIUS * 0.62 * Math.cos(midAngleRad);
          const ly = CENTER + WHEEL_RADIUS * 0.62 * Math.sin(midAngleRad);
          const labelRotation = (i + 0.5) * segmentAngle; // tangencial
          const label = seg.label ?? formatPrizeShort(seg.prize);
          return (
            <g key={seg.id ?? i}>
              <path
                d={path}
                fill={color}
                stroke="var(--color-bg)"
                strokeWidth="2"
              />
              <text
                x={lx}
                y={ly}
                fill="var(--color-accent-fg)"
                fontSize="13"
                fontFamily="system-ui, sans-serif"
                fontWeight="600"
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
        {/* Hub central */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r="18"
          fill="var(--color-bg)"
          stroke="var(--color-accent)"
          strokeWidth="3"
        />
      </svg>
    </div>
  );
}

function segmentPath(
  index: number,
  segmentAngle: number,
  radius: number,
): string {
  // -90 para que segmento 0 arranque arriba (12 o'clock).
  const startRad = (index * segmentAngle - 90) * (Math.PI / 180);
  const endRad = ((index + 1) * segmentAngle - 90) * (Math.PI / 180);
  const sx = CENTER + radius * Math.cos(startRad);
  const sy = CENTER + radius * Math.sin(startRad);
  const ex = CENTER + radius * Math.cos(endRad);
  const ey = CENTER + radius * Math.sin(endRad);
  const largeArc = segmentAngle > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${sx} ${sy} A ${radius} ${radius} 0 ${largeArc} 1 ${ex} ${ey} Z`;
}

// ──────────────────────────────────────────────────────────────────────
// Leyenda de segmentos
// ──────────────────────────────────────────────────────────────────────

function SegmentLegend({ segments }: { segments: WheelSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <div className="w-full max-w-md flex flex-col gap-2 pt-6 border-t border-[var(--color-border)]">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
        Premios posibles
      </span>
      <ul className="grid grid-cols-2 gap-2">
        {segments.map((seg, i) => (
          <li
            key={seg.id ?? i}
            className="flex items-center gap-2 px-3 py-2 card-premium rounded-[var(--radius)]"
          >
            <span
              className="size-2.5 shrink-0"
              style={{
                backgroundColor:
                  SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
              }}
            />
            <span className="text-[12px] text-[var(--color-fg)] truncate">
              {seg.label ?? formatPrizeShort(seg.prize)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatPrizeShort(prize: WheelPrize): string {
  if (prize.kind === 'chips') return `${prize.amount ?? 0} chips`;
  if (prize.kind === 'try_again') return 'Probá de nuevo';
  if (prize.kind === 'bonus') return 'Bono';
  if (prize.kind === 'free_spins') return `${prize.amount ?? 0} free spins`;
  return prize.kind;
}

// ──────────────────────────────────────────────────────────────────────
// Modal del premio
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

  // Sprint 51.11: dopamine burst al revelar premio. Jackpot si chips
  // > 5000 o si es bonus/free_spins (premios "grandes"). Burst normal
  // si chips chico. NO si try_again.
  useEffect(() => {
    if (isTryAgain) return;
    const amount =
      spin.prize.kind === 'chips' ? Number(spin.prize.amount) : 0;
    const isBig =
      spin.prize.kind !== 'chips' || amount >= 5000;
    if (isBig) {
      confettiJackpot();
    } else {
      confettiBurst();
    }
    // Run once on mount — eslint-disable porque queremos solo 1 disparo
    // por mount del modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="relative max-w-md w-full surface-glass rounded-[var(--radius-xl)] p-8 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 size-7 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
        >
          <X className="size-3.5" />
        </button>

        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
          {isTryAgain ? 'Buen intento' : '¡Ganaste!'}
        </span>

        <div
          className={cn(
            'size-20 flex items-center justify-center border-2',
            isTryAgain
              ? 'border-[var(--color-border-strong)] text-[var(--color-fg-subtle)]'
              : 'border-[var(--color-accent)] text-[var(--color-accent-text)] bg-[var(--color-accent-subtle)]',
          )}
        >
          <Icon className="size-10" />
        </div>

        <h2 className="font-display text-[2rem] leading-none tracking-tight text-center">
          {spin.segmentLabel ?? formatPrizeShort(spin.prize)}
        </h2>

        {!isTryAgain && (
          <p className="text-[13px] text-[var(--color-fg-muted)] text-center">
            {spin.prize.kind === 'chips'
              ? 'Ya te lo acreditamos en tu wallet.'
              : spin.prize.kind === 'bonus'
                ? 'Tu bono ya está activo. Revisalo en /play/bonuses.'
                : spin.prize.kind === 'free_spins'
                  ? 'Tus giros gratis están listos.'
                  : 'Disfrutalo.'}
          </p>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button variant="primary" size="md" onClick={onClose}>
            Listo
          </Button>
        </div>
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
