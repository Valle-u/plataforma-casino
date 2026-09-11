/**
 * WheelSvg — la rueda de premios del handoff recreada en SVG (solo la estética;
 * las mecánicas mandan por `docs/27-ruleta-diaria.md`).
 *
 * Geometría del prototipo (02 - desktop): viewBox 660, 12 gajos de 30°, hub
 * amplio, puntero arriba, anillo de luces en la periferia y pills de marca por
 * gajo. Los LABEL son de la config viva del tenant (segment.label / prize),
 * no los del mock del handoff; y el jackpot se detecta por el premio más alto.
 *
 * El `<g>` rotante se expone por `groupRef` y lo controla `lib/wheel/rotation.ts`
 * desde la página (todo el maestro gira alrededor del centro; el hub, el
 * puntero y el anillo de luces quedan fijos).
 */

'use client';

import type { WheelSegment } from '@/lib/hooks/use-player-promotions';

const SIZE = 660;
const CENTER = SIZE / 2;

const R_OUTER = 315; // borde exterior del gajo
const R_INNER = 158; // borde interior del gajo (contra el hub)
const R_LABEL = 238; // radio del medio del label
const R_PILLS = 305; // pills de marca por gajo
const R_RING = 322; // anillo de luces
const R_RIM = 327; // aro exterior

const GAP_DEG = 0.04; // fracción del ángulo de "costura" entre gajos

type PrizeKind = WheelSegment['prize']['kind'];

function polar(deg: number, radius: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: radius * Math.sin(rad), y: -radius * Math.cos(rad) };
}

function wedgePath(
  segStart: number,
  segAngle: number,
  inner: number,
  outer: number,
): string {
  const a0 = segStart + segAngle * GAP_DEG;
  const a1 = segStart + segAngle * (1 - GAP_DEG);
  const p0o = polar(a0, outer);
  const p1o = polar(a1, outer);
  const p1i = polar(a1, inner);
  const p0i = polar(a0, inner);
  const large = segAngle > 180 ? 1 : 0;
  return [
    `M ${p0i.x.toFixed(2)} ${p0i.y.toFixed(2)}`,
    `L ${p0o.x.toFixed(2)} ${p0o.y.toFixed(2)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${p1o.x.toFixed(2)} ${p1o.y.toFixed(2)}`,
    `L ${p1i.x.toFixed(2)} ${p1i.y.toFixed(2)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${p0i.x.toFixed(2)} ${p0i.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

/** [principal, sub]; parte por '·' y después por el primer espacio. */
function splitLabel(raw: string): [string, string] {
  const label = raw.trim();
  if (label.includes('·')) {
    const parts = label.split('·');
    return [parts[0]!.trim(), (parts[1] ?? '').trim()];
  }
  const sp = label.indexOf(' ');
  if (sp > 0) return [label.slice(0, sp), label.slice(sp + 1).trim()];
  return [label, ''];
}

function mainFontSize(label: string): number {
  return Math.max(15, Math.min(34, Math.floor(230 / Math.max(label.length, 1))));
}

/** ¿Este gajo es el jackpot? = el bonus con el monto más alto de la rueda. */
function findJackpotId(segments: WheelSegment[]): string | null {
  let best: { id: string; amount: number } | null = null;
  for (const s of segments) {
    if (s.prize.kind !== 'bonus') continue;
    const amount = Number(s.prize.amount ?? 0);
    if (!best || amount > best.amount) best = { id: s.id, amount };
  }
  return best ? best.id : null;
}

export interface WheelSvgProps {
  segments: WheelSegment[];
  groupRef: (el: SVGGElement | null) => void;
  className?: string;
}

export function WheelSvg({ segments, groupRef, className }: WheelSvgProps) {
  const N = segments.length;
  const jackpotId = findJackpotId(segments);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={className}
      role="img"
      aria-label="Ruleta de premios"
    >
      <defs>
        <radialGradient id="wheel-plate" cx="50%" cy="38%" r="78%">
          <stop offset="0%" stopColor="#1d1733" />
          <stop offset="70%" stopColor="#120d20" />
          <stop offset="100%" stopColor="#0b0814" />
        </radialGradient>
        <radialGradient id="wheel-gold" cx="50%" cy="36%" r="78%">
          <stop offset="0%" stopColor="#ffe49a" />
          <stop offset="55%" stopColor="#f6c45a" />
          <stop offset="100%" stopColor="#e7952b" />
        </radialGradient>
        <linearGradient id="wheel-jackpot" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a574ff" />
          <stop offset="50%" stopColor="#5b34a8" />
          <stop offset="100%" stopColor="#2a1a4d" />
        </linearGradient>
        <radialGradient id="wheel-gray" cx="50%" cy="42%" r="76%">
          <stop offset="0%" stopColor="#6c5d85" />
          <stop offset="100%" stopColor="#423560" />
        </radialGradient>
        <radialGradient id="wheel-hub" cx="50%" cy="42%" r="78%">
          <stop offset="0%" stopColor="#332c4e" />
          <stop offset="100%" stopColor="#171223" />
        </radialGradient>
      </defs>

      {/* Fondo + aro exterior fijos */}
      <circle cx={CENTER} cy={CENTER} r={R_RIM} fill="url(#wheel-plate)" />
      <circle
        cx={CENTER}
        cy={CENTER}
        r={R_RIM}
        fill="none"
        stroke="#f6c45a"
        strokeOpacity="0.14"
        strokeWidth="6"
      />

      {/* Todo el disco (gajos + labels + pills) rota alrededor del centro */}
      <g transform={`translate(${CENTER} ${CENTER})`}>
        <g ref={groupRef}>
          <circle r={R_OUTER} fill="#0c0914" />
          {segments.map((seg, i) => {
            const segAngle = 360 / N;
            const segStart = i * segAngle;
            const isJackpot = jackpotId === seg.id;
            const kind: PrizeKind = seg.prize.kind;
            const fill =
              kind === 'try_again'
                ? 'url(#wheel-gray)'
                : isJackpot
                  ? 'url(#wheel-jackpot)'
                  : 'url(#wheel-gold)';
            const label = seg.label ?? '';
            return (
              <g key={seg.id ?? i}>
                <path
                  d={wedgePath(segStart, segAngle, R_INNER, R_OUTER)}
                  fill={fill}
                  stroke="#0c0914"
                  strokeWidth="2.5"
                />
                <WedgeLabel
                  index={i}
                  segAngle={segAngle}
                  label={label}
                  prizeKind={kind}
                  isJackpot={isJackpot}
                />
                {/* pill de marca por gajo (hits del handoff) */}
                <HitPill index={i} segAngle={segAngle} />
              </g>
            );
          })}
        </g>

        {/* Anillo de luces (FUERA del grupo rotante) */}
        {Array.from({ length: 24 }, (_, j) => {
          const p = polar(j * 15, R_RING);
          return (
            <circle
              key={j}
              cx={p.x}
              cy={p.y}
              r={j % 2 === 0 ? 2.6 : 1.8}
              fill={j % 2 === 0 ? '#f6c45a' : '#8a79b8'}
              opacity={j % 2 === 0 ? 0.9 : 0.55}
            />
          );
        })}

        {/* Puntero fijo arriba */}
        <path
          d="M -9 -292 L 9 -292 L 0 -268 Z"
          fill="#ffd977"
          stroke="#0c0914"
          strokeWidth="3"
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 10px rgba(246,196,90,0.8))' }}
        />

        {/* Hub fijo */}
        <circle r={R_INNER + 6} fill="#0c0914" />
        <circle r={R_INNER} fill="url(#wheel-hub)" />
        <circle r={R_INNER} fill="none" stroke="#f6c45a" strokeOpacity="0.28" strokeWidth="2" />
        <circle r={R_INNER - 26} fill="none" stroke="#8a79b8" strokeOpacity="0.25" strokeWidth="1.5" />
        <circle r={R_INNER - 60} fill="none" stroke="#8a79b8" strokeOpacity="0.18" strokeWidth="1.5" />
        <circle r={R_INNER - 92} fill="#171223" stroke="#f6c45a" strokeOpacity="0.9" strokeWidth="1.5" />
        <circle cx={0} cy={-R_INNER + 40} r={3.5} fill="#f6c45a" opacity="0.85" />
      </g>
    </svg>
  );
}

function HitPill({ index, segAngle }: { index: number; segAngle: number }) {
  const mid = (index + 0.5) * segAngle;
  const p = polar(mid, R_PILLS);
  return (
    <g transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${mid - 90})`}>
      <rect x={-11} y={-4} width={22} height={8} rx={4} fill="#ffffff" opacity="0.92" />
      <rect x={-11} y={-4} width={22} height={8} rx={4} fill="none" stroke="#0c0914" strokeWidth="1" />
    </g>
  );
}

function WedgeLabel({
  index,
  segAngle,
  label,
  prizeKind,
  isJackpot,
}: {
  index: number;
  segAngle: number;
  label: string;
  prizeKind: PrizeKind;
  isJackpot: boolean;
}) {
  const [mainRaw, subRaw] = label ? splitLabel(label) : ['', ''];
  const fallbackMain = mainRaw || (prizeKind === 'try_again' ? 'SUERTE' : 'BONO');
  const fallbackSub = subRaw || (prizeKind === 'try_again' ? 'LA PRÓXIMA' : '');
  const mid = (index + 0.5) * segAngle;
  const p = polar(mid, R_LABEL);
  const flip = mid > 90 && mid < 270 ? 180 : 0;
  const frameRot = mid - 90 + flip;
  const fs = mainFontSize(fallbackMain);
  const subFs = Math.min(15, Math.max(10, Math.floor(150 / Math.max(fallbackSub.length, 1))));
  const spread = fs * 0.58;
  const fill =
    prizeKind === 'try_again' ? '#c2b4da' : isJackpot ? '#ffffff' : '#2a1a33';
  const fontWeight = isJackpot ? 800 : 700;

  return (
    <g
      transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${frameRot})`}
      style={{ pointerEvents: 'none' }}
    >
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Outfit, system-ui, sans-serif"
        fontWeight={fontWeight}
        fill={fill}
        fontSize={fs}
        opacity="0.96"
      >
        <tspan x={-spread} dy="0">
          {fallbackMain}
        </tspan>
        {fallbackSub && (
          <tspan x={spread} dy="0" fontSize={subFs} opacity="0.82">
            {fallbackSub}
          </tspan>
        )}
      </text>
    </g>
  );
}