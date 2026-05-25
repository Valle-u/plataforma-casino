/**
 * Paytable — muestra los pagos por símbolo arriba del juego.
 *
 * Replica el layout del juego original: 2 filas × 4 columnas de cards.
 * Cada card tiene:
 *   - El sprite del símbolo a la izquierda.
 *   - Lista de pagos (5/4/3) en dorado a la derecha.
 *
 * En el centro de la primera fila va el logo "Joker's Jewels".
 *
 * Las multiplicaciones se calculan asumiendo bet=200 (paytable del
 * original muestra valores en EUR para apuesta máxima — visualmente
 * impactante). En nuestro caso el bet es configurable, así que
 * mostramos el multiplicador real del paytable × 200 como "valor
 * de referencia" en euros simulados.
 */

import { PAYTABLE, type SymbolCode } from '@casino/games-jokers-jewels';
import { Symbol } from './Symbol';

// Orden de aparición en el paytable (top tier a la izquierda).
const TIER_TOP: SymbolCode[] = ['joker', 'crown', 'mandolin', 'boots'];
const TIER_BOTTOM: SymbolCode[] = ['diamond_pink', 'ruby', 'sapphire', 'emerald'];

// Bet de referencia que multiplica el paytable para mostrar valores
// "visuales" en euros simulados. 200 es lo que usa el original.
const REFERENCE_BET = 200;

export function Paytable() {
  return (
    <div className="jj-paytable">
      {/* Fila 1: 2 cards izquierda + logo + 2 cards derecha */}
      <div className="jj-paytable-row">
        {TIER_TOP.slice(0, 2).map((code) => (
          <PaytableCard key={code} code={code} />
        ))}
        <Logo />
        {TIER_TOP.slice(2, 4).map((code) => (
          <PaytableCard key={code} code={code} />
        ))}
      </div>
      {/* Fila 2: 4 cards (gemas) */}
      <div className="jj-paytable-row">
        {TIER_BOTTOM.map((code) => (
          <PaytableCard key={code} code={code} />
        ))}
      </div>
      <p className="jj-paytable-footer">
        TODOS LOS SÍMBOLOS GENERAN GANANCIAS DE IZQUIERDA A DERECHA. EL
        BONUS SE PAGA EN CUALQUIER POSICIÓN.
      </p>
      <style>{`
        .jj-paytable {
          padding: 12px 18px;
          background: linear-gradient(180deg, var(--jj-bg-deep), var(--jj-bg-base));
          border: 3px solid var(--jj-chrome-mid);
          border-radius: 12px 12px 0 0;
          box-shadow: var(--jj-shadow-inset), 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        .jj-paytable-row {
          display: grid;
          grid-template-columns: 1fr 1fr 2fr 1fr 1fr;
          gap: 8px;
          align-items: center;
        }
        .jj-paytable-row + .jj-paytable-row {
          margin-top: 8px;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .jj-paytable-footer {
          margin-top: 10px;
          text-align: center;
          font-size: 10px;
          font-weight: 600;
          color: var(--jj-text-cream);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
      `}</style>
    </div>
  );
}

function PaytableCard({ code }: { code: SymbolCode }) {
  const pays = PAYTABLE[code];
  return (
    <div className="jj-paytable-card">
      <div className="jj-paytable-card-symbol">
        <Symbol code={code} />
      </div>
      <div className="jj-paytable-card-pays">
        <PayRow count={5} amount={pays[5] * REFERENCE_BET / 5} />
        <PayRow count={4} amount={pays[4] * REFERENCE_BET / 5} />
        <PayRow count={3} amount={pays[3] * REFERENCE_BET / 5} />
      </div>
      <style>{`
        .jj-paytable-card {
          display: grid;
          grid-template-columns: 44px 1fr;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          background: linear-gradient(180deg, rgba(60, 20, 100, 0.6), rgba(40, 10, 70, 0.8));
          border: 2px solid var(--jj-orange);
          border-radius: 8px;
          box-shadow: inset 0 1px 0 rgba(255, 200, 100, 0.3), 0 2px 4px rgba(0, 0, 0, 0.3);
          min-height: 56px;
        }
        .jj-paytable-card-symbol {
          width: 40px;
          height: 40px;
        }
        .jj-paytable-card-pays {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
      `}</style>
    </div>
  );
}

function PayRow({ count, amount }: { count: number; amount: number }) {
  const formatted = amount.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <div className="jj-payrow">
      <span className="jj-payrow-count">{count} -</span>
      <span className="jj-payrow-amount">{formatted} €</span>
      <style>{`
        .jj-payrow {
          display: flex;
          gap: 4px;
          font-size: 11px;
          font-weight: 700;
          color: var(--jj-gold);
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
          line-height: 1.1;
          letter-spacing: 0.02em;
        }
        .jj-payrow-count {
          color: var(--jj-gold);
        }
        .jj-payrow-amount {
          color: var(--jj-gold);
        }
      `}</style>
    </div>
  );
}

function Logo() {
  return (
    <div className="jj-logo">
      <div className="jj-logo-joker">Joker&apos;s</div>
      <div className="jj-logo-jewels">Jewels</div>
      <span className="jj-logo-tm">™</span>
      <style>{`
        .jj-logo {
          position: relative;
          text-align: center;
          padding: 0 8px;
          font-family: var(--jj-font);
        }
        .jj-logo-joker {
          font-size: 22px;
          font-weight: 700;
          font-style: italic;
          color: var(--jj-red);
          text-shadow:
            -1px -1px 0 #fff,
            1px -1px 0 #fff,
            -1px 1px 0 #fff,
            1px 1px 0 #fff,
            0 2px 4px rgba(0, 0, 0, 0.5);
          line-height: 0.9;
          letter-spacing: 0.02em;
        }
        .jj-logo-jewels {
          font-size: 22px;
          font-weight: 700;
          font-style: italic;
          color: var(--jj-gold);
          text-shadow:
            -1px -1px 0 #5a3000,
            1px -1px 0 #5a3000,
            -1px 1px 0 #5a3000,
            1px 1px 0 #5a3000,
            0 2px 4px rgba(0, 0, 0, 0.6);
          line-height: 0.9;
          letter-spacing: 0.02em;
          margin-top: 2px;
        }
        .jj-logo-tm {
          position: absolute;
          top: 4px;
          right: -2px;
          font-size: 10px;
          color: var(--jj-text-cream);
        }
      `}</style>
    </div>
  );
}
