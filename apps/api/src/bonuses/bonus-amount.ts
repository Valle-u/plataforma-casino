/**
 * Cálculo del monto de bono según la planilla (`bonus_definitions.config`).
 *
 * Sprint 59 — regla de negocio del dueño:
 *   - `welcome` / `reload`: match % sobre el depósito (`matchPct`, tope
 *     `maxAmount`). Es el único modo que soportaba el approve hasta ahora.
 *   - `manual`: monto FIJO `config.defaultAmount`. Se respeta exactamente
 *     tanto al aprobar un depósito como en el grant manual.
 *   - `no_deposit`: monto FIJO `config.amount`. Igual que manual.
 *   - El resto de tipos (cashback, free_spins, referral) no tienen un monto
 *     canónico acreditable en un depósito → `null`.
 *
 * Un solo lugar para que el approve de depósitos y el grant manual nunca
 * diverjan en el cálculo.
 */

export interface MatchBonusCalc {
  kind: 'match';
  matchPct: number;
  maxAmount: number;
}

export interface FixedBonusCalc {
  kind: 'fixed';
  amount: string;
}

export type DepositBonusCalc = MatchBonusCalc | FixedBonusCalc | null;

/** Tipos de planilla que sirven para asociar a un depósito aprobado. */
export const DEPOSIT_ELIGIBLE_TYPES = [
  'welcome',
  'reload',
  'manual',
  'no_deposit',
] as const;

export function isDepositEligibleType(type: string): boolean {
  return (DEPOSIT_ELIGIBLE_TYPES as readonly string[]).includes(type);
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Resuelve el cálculo de monto de una planilla a partir de su `config`.
 * Devuelve `null` si la planilla no define un monto computable (config
 * inválida o tipo no apto para depósito).
 */
export function depositBonusCalc(def: {
  type: string;
  config: unknown;
}): DepositBonusCalc {
  const config = (def.config ?? {}) as Record<string, unknown>;
  switch (def.type) {
    case 'welcome':
    case 'reload': {
      const matchPct = Number(config.matchPct ?? 0);
      if (!(matchPct > 0)) return null;
      const maxAmount = Number(config.maxAmount ?? Infinity);
      return { kind: 'match', matchPct, maxAmount };
    }
    case 'manual': {
      const amt = Number(config.defaultAmount ?? 0);
      if (!(amt > 0)) return null;
      return { kind: 'fixed', amount: round2(amt) };
    }
    case 'no_deposit': {
      const amt = Number(config.amount ?? 0);
      if (!(amt > 0)) return null;
      return { kind: 'fixed', amount: round2(amt) };
    }
    default:
      return null;
  }
}

/** Monto fijo canónico de una planilla (solo manual/no_deposit). */
export function fixedBonusAmount(def: {
  type: string;
  config: unknown;
}): string | null {
  const calc = depositBonusCalc(def);
  return calc?.kind === 'fixed' ? calc.amount : null;
}

/** Aplica el match % sobre el depósito con el tope de la planilla. */
export function computeMatchBonus(
  depositAmountChips: string,
  calc: MatchBonusCalc,
): string {
  let amount = parseFloat(depositAmountChips) * (calc.matchPct / 100);
  if (calc.maxAmount < Infinity) {
    amount = Math.min(amount, calc.maxAmount);
  }
  return round2(amount);
}
