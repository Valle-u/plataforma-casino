/**
 * BottomUI — barra inferior con crédito, apuesta, botones de control.
 *
 * Layout horizontal (replica el original Pragmatic):
 *   [hamburger][info] CRÉDITO 100.000,00€   APUESTA 1,00€ |
 *   [centro: hint "MANTENGA ESPACIO PARA TURBO"]
 *   [bet−][SPIN BUTTON gigante][bet+] / TIR.AUTO label abajo
 *
 * Sub-fase 2A: botones existen pero no-functional. El spin button hace
 * onSpin callback (que el padre maneja).
 */

import { useCallback } from 'react';

interface BottomUIProps {
  credit: number;
  bet: number;
  onSpin: () => void;
  onBetIncrease: () => void;
  onBetDecrease: () => void;
  spinning: boolean;
}

export function BottomUI({
  credit,
  bet,
  onSpin,
  onBetIncrease,
  onBetDecrease,
  spinning,
}: BottomUIProps) {
  const fmt = useCallback(
    (n: number) =>
      n.toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  return (
    <div className="jj-bottom">
      {/* Izquierda: menú + info + crédito + apuesta */}
      <div className="jj-bottom-left">
        <button className="jj-icon-btn" aria-label="Menú">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <button className="jj-icon-btn" aria-label="Información">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="8" strokeLinecap="round" />
            <line x1="12" y1="12" x2="12" y2="16" strokeLinecap="round" />
          </svg>
        </button>
        <div className="jj-stat">
          <span className="jj-stat-label">CRÉDITO</span>
          <span className="jj-stat-value">{fmt(credit)} €</span>
        </div>
        <div className="jj-stat">
          <span className="jj-stat-label">APUESTA</span>
          <span className="jj-stat-value">{fmt(bet)} €</span>
        </div>
      </div>

      {/* Centro: hint */}
      <div className="jj-bottom-center">
        MANTENGA LA TECLA ESPACIO PARA TIRADA TURBO
      </div>

      {/* Derecha: bet- + spin + bet+ + auto */}
      <div className="jj-bottom-right">
        <button
          className="jj-bet-btn"
          onClick={onBetDecrease}
          aria-label="Bajar apuesta"
          disabled={spinning}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="3">
            <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="jj-spin-btn"
          onClick={onSpin}
          aria-label="Girar"
          disabled={spinning}
        >
          <svg viewBox="0 0 64 64" width="42" height="42" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
            <path d="M 52 16 A 22 22 0 1 0 56 32" />
            <polyline points="42 8 52 16 44 24" />
          </svg>
          <span className="jj-spin-btn-label">TIR. AUTO.</span>
        </button>
        <button
          className="jj-bet-btn"
          onClick={onBetIncrease}
          aria-label="Subir apuesta"
          disabled={spinning}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="3">
            <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
            <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <style>{`
        .jj-bottom {
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 16px;
          padding: 14px 18px;
          background: linear-gradient(180deg, var(--jj-bg-deep), var(--jj-bg-deepest));
          border-top: 2px solid var(--jj-chrome-mid);
          border-radius: 0 0 12px 12px;
          color: var(--jj-text-white);
        }

        .jj-bottom-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .jj-icon-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--jj-text-cream);
          opacity: 0.85;
          transition: opacity 150ms;
        }
        .jj-icon-btn:hover {
          opacity: 1;
        }

        .jj-stat {
          display: flex;
          flex-direction: column;
          gap: 1px;
          line-height: 1;
        }
        .jj-stat-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--jj-gold);
          letter-spacing: 0.08em;
        }
        .jj-stat-value {
          font-size: 16px;
          font-weight: 700;
          color: var(--jj-text-white);
          letter-spacing: 0.01em;
        }

        .jj-bottom-center {
          font-size: 11px;
          font-weight: 600;
          color: var(--jj-text-cream);
          letter-spacing: 0.06em;
          text-align: center;
          opacity: 0.85;
        }

        .jj-bottom-right {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .jj-bet-btn {
          width: 38px;
          height: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at 30% 30%, var(--jj-chrome-bright), var(--jj-chrome-mid));
          color: var(--jj-bg-deepest);
          border-radius: 50%;
          box-shadow:
            0 2px 4px rgba(0, 0, 0, 0.5),
            inset 0 1px 1px rgba(255, 255, 255, 0.6),
            inset 0 -1px 1px rgba(0, 0, 0, 0.4);
          transition: transform 100ms;
        }
        .jj-bet-btn:active:not(:disabled) {
          transform: scale(0.92);
        }
        .jj-bet-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* ─── Spin button — chrome 3D con ring dorado glowing ─────────
         * Estructura 3 capas:
         *   1. Outer ring (border via padding + bg) — dorado glow
         *   2. Middle bezel chrome (inset cromo)
         *   3. Inner button cara cromo con depth
         * Animación pulse cuando está listo (no spinning).
         */
        .jj-spin-btn {
          position: relative;
          width: 82px;
          height: 82px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          background:
            /* Capa 1: outer chrome ring (gradient) */
            radial-gradient(
              circle at 50% 30%,
              var(--jj-chrome-bright) 0%,
              var(--jj-chrome-mid) 45%,
              var(--jj-chrome-dark) 80%,
              var(--jj-chrome-shadow) 100%
            );
          color: var(--jj-bg-deepest);
          border-radius: 50%;
          box-shadow:
            /* Glow exterior dorado sutil */
            0 0 18px rgba(255, 215, 0, 0.35),
            /* Depth shadow inferior */
            0 6px 14px rgba(0, 0, 0, 0.75),
            0 2px 4px rgba(0, 0, 0, 0.5),
            /* Highlight superior cromo */
            inset 0 3px 4px rgba(255, 255, 255, 0.85),
            /* Sombra inferior interna */
            inset 0 -3px 6px rgba(0, 0, 0, 0.6),
            /* Borde sutil dorado interno */
            inset 0 0 0 1.5px rgba(255, 215, 0, 0.3);
          transition: transform 100ms, box-shadow 200ms;
          animation: jj-spin-pulse 2.4s ease-in-out infinite;
        }

        /* Pulse glow sutil cuando está listo */
        @keyframes jj-spin-pulse {
          0%, 100% {
            box-shadow:
              0 0 18px rgba(255, 215, 0, 0.35),
              0 6px 14px rgba(0, 0, 0, 0.75),
              0 2px 4px rgba(0, 0, 0, 0.5),
              inset 0 3px 4px rgba(255, 255, 255, 0.85),
              inset 0 -3px 6px rgba(0, 0, 0, 0.6),
              inset 0 0 0 1.5px rgba(255, 215, 0, 0.3);
          }
          50% {
            box-shadow:
              0 0 28px rgba(255, 215, 0, 0.6),
              0 6px 14px rgba(0, 0, 0, 0.75),
              0 2px 4px rgba(0, 0, 0, 0.5),
              inset 0 3px 4px rgba(255, 255, 255, 0.95),
              inset 0 -3px 6px rgba(0, 0, 0, 0.6),
              inset 0 0 0 1.5px rgba(255, 215, 0, 0.6);
          }
        }

        .jj-spin-btn:hover:not(:disabled) {
          animation-duration: 1.2s;
        }
        .jj-spin-btn:active:not(:disabled) {
          transform: scale(0.94);
          animation: none;
        }
        .jj-spin-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          animation: none;
        }
        .jj-spin-btn-label {
          position: absolute;
          bottom: -18px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          font-weight: 700;
          color: var(--jj-text-cream);
          letter-spacing: 0.08em;
          white-space: nowrap;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
        }
      `}</style>
    </div>
  );
}
