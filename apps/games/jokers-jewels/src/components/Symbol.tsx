/**
 * Symbol — renderiza uno de los 8 símbolos del slot como SVG inline.
 *
 * Versión sub-fase 2A: dibujados a mano con shapes simples (paths,
 * circles, gradients). Suficientemente premium para que se reconozca
 * cada símbolo, pero NO copia pixel-perfect de Pragmatic (que es
 * copyright). Cuando llegue Sub-fase 2D se reemplaza por sprites
 * generados con IA o comprados.
 *
 * Diseño:
 *   - Cada símbolo encaja en viewBox 100×100 (cuadrado, escalable).
 *   - Paleta coherente con el original (joker rojo+amarillo, corona
 *     dorada, gemas en sus colores característicos, etc.).
 *   - Filtro `drop-shadow` sutil para dar profundidad.
 */

import type { SymbolCode } from '@casino/games-jokers-jewels';

interface SymbolProps {
  code: SymbolCode;
  /** Si true, el símbolo "brilla" (usado para win-line highlight). */
  glowing?: boolean;
}

export function Symbol({ code, glowing = false }: SymbolProps) {
  return (
    <div
      className="jj-symbol"
      style={{
        filter: glowing
          ? 'drop-shadow(0 0 8px var(--jj-gold-bright)) brightness(1.15)'
          : 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
        transition: 'filter 200ms ease',
      }}
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        {SYMBOLS[code]}
      </svg>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SVG paths por símbolo
// ──────────────────────────────────────────────────────────────────────

const SYMBOLS: Record<SymbolCode, React.ReactNode> = {
  // ─── Joker (wild): cara payaso con sombrero rojo+amarillo de 3 puntas ───
  joker: (
    <>
      <defs>
        <linearGradient id="joker-hat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff3b6b" />
          <stop offset="100%" stopColor="#a8003a" />
        </linearGradient>
        <linearGradient id="joker-hat-yellow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffec5c" />
          <stop offset="100%" stopColor="#d4a500" />
        </linearGradient>
      </defs>
      {/* Sombrero de 3 puntas */}
      <path d="M 20 35 L 30 12 L 38 32 L 50 8 L 62 32 L 70 12 L 80 35 Z" fill="url(#joker-hat)" />
      <path d="M 30 12 L 28 8 L 32 8 Z" fill="url(#joker-hat-yellow)" />
      <path d="M 50 8 L 48 4 L 52 4 Z" fill="url(#joker-hat-yellow)" />
      <path d="M 70 12 L 68 8 L 72 8 Z" fill="url(#joker-hat-yellow)" />
      {/* Bola amarilla en cada punta */}
      <circle cx="30" cy="8" r="2.5" fill="#ffec5c" />
      <circle cx="50" cy="4" r="2.5" fill="#ffec5c" />
      <circle cx="70" cy="8" r="2.5" fill="#ffec5c" />
      {/* Cara */}
      <circle cx="50" cy="55" r="22" fill="#fff5e6" />
      {/* Ojos */}
      <ellipse cx="42" cy="52" rx="3" ry="4" fill="#1a0a2e" />
      <ellipse cx="58" cy="52" rx="3" ry="4" fill="#1a0a2e" />
      {/* Mejillas rojas */}
      <circle cx="38" cy="62" r="3" fill="#ff6b8a" opacity="0.6" />
      <circle cx="62" cy="62" r="3" fill="#ff6b8a" opacity="0.6" />
      {/* Sonrisa */}
      <path d="M 40 64 Q 50 72 60 64" stroke="#1a0a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Cuello/banda */}
      <path d="M 28 78 L 72 78 L 68 92 L 32 92 Z" fill="url(#joker-hat)" />
      {/* Detalle del cuello — bolitas amarillas */}
      <circle cx="35" cy="85" r="2" fill="#ffec5c" />
      <circle cx="50" cy="85" r="2" fill="#ffec5c" />
      <circle cx="65" cy="85" r="2" fill="#ffec5c" />
    </>
  ),

  // ─── Crown: corona dorada con "BONUS" implícito ───
  crown: (
    <>
      <defs>
        <linearGradient id="crown-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffec5c" />
          <stop offset="50%" stopColor="#ffd700" />
          <stop offset="100%" stopColor="#b8860b" />
        </linearGradient>
      </defs>
      {/* Base de la corona */}
      <path d="M 15 50 L 25 70 L 75 70 L 85 50 L 70 60 L 50 35 L 30 60 Z" fill="url(#crown-gold)" stroke="#8a6700" strokeWidth="1.5" />
      {/* Banda inferior */}
      <rect x="15" y="70" width="70" height="14" fill="url(#crown-gold)" stroke="#8a6700" strokeWidth="1.5" />
      {/* Gemas en la banda */}
      <circle cx="30" cy="77" r="3" fill="#dc2626" stroke="#8a0010" strokeWidth="0.8" />
      <circle cx="50" cy="77" r="4" fill="#16a34a" stroke="#0a5a20" strokeWidth="0.8" />
      <circle cx="70" cy="77" r="3" fill="#2563eb" stroke="#0a2a8a" strokeWidth="0.8" />
      {/* Puntas redondeadas */}
      <circle cx="15" cy="50" r="3.5" fill="url(#crown-gold)" stroke="#8a6700" strokeWidth="1" />
      <circle cx="50" cy="35" r="4" fill="url(#crown-gold)" stroke="#8a6700" strokeWidth="1" />
      <circle cx="85" cy="50" r="3.5" fill="url(#crown-gold)" stroke="#8a6700" strokeWidth="1" />
      {/* Highlights — brillo */}
      <path d="M 22 55 L 28 65" stroke="#fff5e6" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
      <path d="M 50 41 L 55 50" stroke="#fff5e6" strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
    </>
  ),

  // ─── Mandolin: instrumento dorado ───
  mandolin: (
    <>
      <defs>
        <linearGradient id="mandolin-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffb84d" />
          <stop offset="50%" stopColor="#d4881c" />
          <stop offset="100%" stopColor="#8b4f00" />
        </linearGradient>
      </defs>
      {/* Cuerpo pera */}
      <ellipse cx="55" cy="62" rx="28" ry="25" fill="url(#mandolin-wood)" stroke="#5a2f00" strokeWidth="1.5" />
      {/* Hueco de resonancia */}
      <circle cx="55" cy="62" r="8" fill="#1a0a2e" />
      <circle cx="55" cy="62" r="6" fill="#3a1a4e" />
      {/* Mástil */}
      <rect x="18" y="20" width="9" height="42" rx="2" fill="url(#mandolin-wood)" stroke="#5a2f00" strokeWidth="1" transform="rotate(-25 22.5 41)" />
      {/* Clavijero */}
      <rect x="11" y="8" width="14" height="14" rx="3" fill="#5a2f00" stroke="#3a1a00" strokeWidth="1" transform="rotate(-25 18 15)" />
      {/* Cuerdas */}
      <line x1="22" y1="18" x2="58" y2="68" stroke="#fff5e6" strokeWidth="0.5" opacity="0.6" />
      <line x1="25" y1="18" x2="61" y2="68" stroke="#fff5e6" strokeWidth="0.5" opacity="0.6" />
      <line x1="28" y1="18" x2="64" y2="68" stroke="#fff5e6" strokeWidth="0.5" opacity="0.6" />
      {/* Highlight */}
      <ellipse cx="48" cy="48" rx="6" ry="3" fill="#fff5e6" opacity="0.3" />
    </>
  ),

  // ─── Boots: par de botas rosadas con campanas (rojo en el paytable) ───
  boots: (
    <>
      <defs>
        <linearGradient id="boots-pink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff6bae" />
          <stop offset="100%" stopColor="#9b1d5a" />
        </linearGradient>
      </defs>
      {/* Bota izquierda */}
      <path d="M 25 30 Q 25 25 30 25 L 38 25 Q 43 25 43 30 L 43 55 Q 43 60 48 60 L 50 60 Q 52 60 52 65 L 52 75 L 22 75 L 22 65 Q 22 60 25 60 L 25 30 Z" fill="url(#boots-pink)" stroke="#5a0030" strokeWidth="1.5" />
      {/* Bota derecha */}
      <path d="M 57 30 Q 57 25 62 25 L 70 25 Q 75 25 75 30 L 75 55 Q 75 60 80 60 L 82 60 Q 84 60 84 65 L 84 75 L 54 75 L 54 65 Q 54 60 57 60 L 57 30 Z" fill="url(#boots-pink)" stroke="#5a0030" strokeWidth="1.5" />
      {/* Campanas amarillas en cada bota */}
      <circle cx="34" cy="25" r="4" fill="#ffec5c" stroke="#8a6700" strokeWidth="1" />
      <circle cx="66" cy="25" r="4" fill="#ffec5c" stroke="#8a6700" strokeWidth="1" />
      <circle cx="34" cy="25" r="1.5" fill="#8a6700" />
      <circle cx="66" cy="25" r="1.5" fill="#8a6700" />
      {/* Highlight de las botas */}
      <ellipse cx="30" cy="45" rx="2" ry="10" fill="#fff5e6" opacity="0.25" />
      <ellipse cx="62" cy="45" rx="2" ry="10" fill="#fff5e6" opacity="0.25" />
    </>
  ),

  // ─── Diamond pink: diamante rosa ───
  diamond_pink: (
    <>
      <defs>
        <linearGradient id="dia-pink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffc1e0" />
          <stop offset="50%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#8a1252" />
        </linearGradient>
      </defs>
      {/* Forma del diamante: hexágono alargado vertical con facetas */}
      <path d="M 50 12 L 78 38 L 50 88 L 22 38 Z" fill="url(#dia-pink)" stroke="#5a0a36" strokeWidth="1.5" />
      {/* Líneas de facetado */}
      <path d="M 22 38 L 78 38" stroke="#ffd0eb" strokeWidth="0.8" />
      <path d="M 50 12 L 50 88" stroke="#5a0a36" strokeWidth="0.6" opacity="0.5" />
      <path d="M 22 38 L 50 12 L 78 38" fill="#fff5e6" opacity="0.3" />
      {/* Highlight brillante */}
      <path d="M 38 22 L 45 35" stroke="#fff5e6" strokeWidth="2" opacity="0.7" strokeLinecap="round" />
    </>
  ),

  // ─── Ruby: gema roja con forma de diamante también ───
  ruby: (
    <>
      <defs>
        <linearGradient id="ruby-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff6b8a" />
          <stop offset="50%" stopColor="#dc2626" />
          <stop offset="100%" stopColor="#7f0a18" />
        </linearGradient>
      </defs>
      <path d="M 50 12 L 78 38 L 50 88 L 22 38 Z" fill="url(#ruby-red)" stroke="#5a0010" strokeWidth="1.5" />
      <path d="M 22 38 L 78 38" stroke="#ffb5c0" strokeWidth="0.8" />
      <path d="M 50 12 L 50 88" stroke="#5a0010" strokeWidth="0.6" opacity="0.5" />
      <path d="M 22 38 L 50 12 L 78 38" fill="#fff5e6" opacity="0.3" />
      <path d="M 38 22 L 45 35" stroke="#fff5e6" strokeWidth="2" opacity="0.7" strokeLinecap="round" />
    </>
  ),

  // ─── Sapphire: gema celeste/aguamarina ───
  sapphire: (
    <>
      <defs>
        <linearGradient id="sap-cyan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b3eaef" />
          <stop offset="50%" stopColor="#4dd0e1" />
          <stop offset="100%" stopColor="#006978" />
        </linearGradient>
      </defs>
      <path d="M 50 12 L 78 38 L 50 88 L 22 38 Z" fill="url(#sap-cyan)" stroke="#004a55" strokeWidth="1.5" />
      <path d="M 22 38 L 78 38" stroke="#dcf3f5" strokeWidth="0.8" />
      <path d="M 50 12 L 50 88" stroke="#004a55" strokeWidth="0.6" opacity="0.5" />
      <path d="M 22 38 L 50 12 L 78 38" fill="#fff5e6" opacity="0.3" />
      <path d="M 38 22 L 45 35" stroke="#fff5e6" strokeWidth="2" opacity="0.7" strokeLinecap="round" />
    </>
  ),

  // ─── Emerald: gema azul oscuro (en el original Joker's es azul, no
  //     verde — match con el screenshot del dueño donde la 8va gema
  //     es un círculo azul tipo "bola de cristal") ───
  emerald: (
    <>
      <defs>
        <radialGradient id="emer-blue" cx="0.3" cy="0.3" r="0.8">
          <stop offset="0%" stopColor="#a0c8ff" />
          <stop offset="40%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#0a1f5a" />
        </radialGradient>
      </defs>
      {/* Esfera */}
      <circle cx="50" cy="55" r="32" fill="url(#emer-blue)" stroke="#0a1f5a" strokeWidth="1.5" />
      {/* Highlight superior izquierdo */}
      <ellipse cx="38" cy="40" rx="10" ry="6" fill="#fff5e6" opacity="0.5" />
      <ellipse cx="34" cy="36" rx="4" ry="2.5" fill="#fff5e6" opacity="0.8" />
      {/* Brillo decorativo */}
      <circle cx="58" cy="65" r="2" fill="#fff5e6" opacity="0.4" />
    </>
  ),
};
