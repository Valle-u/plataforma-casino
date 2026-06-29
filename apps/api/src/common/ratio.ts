/**
 * Conversión ficha↔plata según el ratio (`chips_per_unit`) del método de pago.
 *
 * Blindaje del núcleo económico, Parte B (B-build-2). Ver docs/16-tesoreria.md §4-5.
 *
 * Aritmética con BigInt sobre representación escalada (sin floats) para
 * preservar precisión exacta. Escalas: fiat 2 decimales, ratio 4, fichas 2.
 */

const FIAT_DECIMALS = 2;
const RATIO_DECIMALS = 4;
const CHIPS_DECIMALS = 2;

/** Parsea un decimal string a BigInt escalado por 10^decimals. */
function toScaled(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  const neg = trimmed.startsWith('-');
  const v = neg ? trimmed.slice(1) : trimmed;
  const [intPart, fracRaw = ''] = v.split('.');
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  const scaled = BigInt((intPart || '0') + frac);
  return neg ? -scaled : scaled;
}

/** Formatea un BigInt escalado por 10^decimals de vuelta a decimal string. */
function fromScaled(scaled: bigint, decimals: number): string {
  const neg = scaled < 0n;
  const abs = (neg ? -scaled : scaled).toString().padStart(decimals + 1, '0');
  const cut = abs.length - decimals;
  const intPart = abs.slice(0, cut);
  const fracPart = abs.slice(cut);
  return (neg ? '-' : '') + (decimals > 0 ? `${intPart}.${fracPart}` : intPart);
}

/** Redondeo half-up de num/den. den > 0; num ≥ 0 en nuestros usos. */
function roundedDiv(num: bigint, den: bigint): bigint {
  return (num + den / 2n) / den;
}

/**
 * fichas = monto_fiat × chips_per_unit (redondeado a 2 decimales).
 * Ej: 5000 ARS × 1 = 5000 fichas; 10 USDT × 1000 = 10000 fichas.
 */
export function chipsFromFiat(amountFiat: string, chipsPerUnit: string): string {
  const fiat = toScaled(amountFiat, FIAT_DECIMALS); // ×10^2
  const ratio = toScaled(chipsPerUnit, RATIO_DECIMALS); // ×10^4
  const product = fiat * ratio; // ×10^6
  const chipsScaled = roundedDiv(product, 10n ** BigInt(RATIO_DECIMALS)); // ×10^2
  return fromScaled(chipsScaled, CHIPS_DECIMALS);
}

/**
 * monto_fiat = fichas ÷ chips_per_unit (redondeado a 2 decimales).
 * Ej: 5000 fichas ÷ 1 = 5000 ARS; 10000 fichas ÷ 1000 = 10 USDT.
 */
export function fiatFromChips(amountChips: string, chipsPerUnit: string): string {
  const chips = toScaled(amountChips, CHIPS_DECIMALS); // ×10^2
  const ratio = toScaled(chipsPerUnit, RATIO_DECIMALS); // ×10^4
  if (ratio === 0n) return fromScaled(0n, FIAT_DECIMALS);
  const numerator = chips * 10n ** BigInt(RATIO_DECIMALS); // ×10^6
  const fiatScaled = roundedDiv(numerator, ratio); // ×10^2
  return fromScaled(fiatScaled, FIAT_DECIMALS);
}
