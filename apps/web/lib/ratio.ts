/**
 * Conversión ficha↔plata según el ratio (chips_per_unit) del método de pago.
 * Espejo de apps/api/src/common/ratio.ts (Blindaje núcleo económico, Parte B) —
 * usado en el front solo para PREVISUALIZAR; el server es el autoritativo.
 *
 * BigInt sobre representación escalada (sin floats). Escalas: fiat 2, ratio 4,
 * fichas 2 decimales.
 */

const FIAT_DECIMALS = 2;
const RATIO_DECIMALS = 4;
const CHIPS_DECIMALS = 2;

function toScaled(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  const neg = trimmed.startsWith('-');
  const v = neg ? trimmed.slice(1) : trimmed;
  const [intPart, fracRaw = ''] = v.split('.');
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  const scaled = BigInt((intPart || '0') + frac);
  return neg ? -scaled : scaled;
}

function fromScaled(scaled: bigint, decimals: number): string {
  const neg = scaled < 0n;
  const abs = (neg ? -scaled : scaled).toString().padStart(decimals + 1, '0');
  const cut = abs.length - decimals;
  return (neg ? '-' : '') + abs.slice(0, cut) + '.' + abs.slice(cut);
}

function roundedDiv(num: bigint, den: bigint): bigint {
  return (num + den / 2n) / den;
}

/** fichas = monto_fiat × chips_per_unit (redondeado a 2 decimales). */
export function chipsFromFiat(amountFiat: string, chipsPerUnit: string): string {
  const fiat = toScaled(amountFiat, FIAT_DECIMALS);
  const ratio = toScaled(chipsPerUnit, RATIO_DECIMALS);
  const product = fiat * ratio;
  const chipsScaled = roundedDiv(product, 10n ** BigInt(RATIO_DECIMALS));
  return fromScaled(chipsScaled, CHIPS_DECIMALS);
}

/** monto_fiat = fichas ÷ chips_per_unit (redondeado a 2 decimales). */
export function fiatFromChips(amountChips: string, chipsPerUnit: string): string {
  const chips = toScaled(amountChips, CHIPS_DECIMALS);
  const ratio = toScaled(chipsPerUnit, RATIO_DECIMALS);
  if (ratio === 0n) return fromScaled(0n, FIAT_DECIMALS);
  const numerator = chips * 10n ** BigInt(RATIO_DECIMALS);
  const fiatScaled = roundedDiv(numerator, ratio);
  return fromScaled(fiatScaled, FIAT_DECIMALS);
}
