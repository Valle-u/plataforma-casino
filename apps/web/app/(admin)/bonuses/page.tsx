/**
 * /bonuses — deshabilitado temporalmente.
 *
 * La sección de bonos individuales se simplificó. Los bonos ahora se
 * otorgan por depósito (selección del operador al aprobar) o manualmente
 * desde el drawer del usuario. Las fichas de bono se acreditan directo
 * al bonus_balance (dual wallet).
 *
 * La planilla de bonos (bonus-definitions) sigue operativa.
 */

export default function BonusesDisabledPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24">
      <div className="rounded-full bg-[var(--color-bg-subtle)] p-4">
        <svg
          className="size-10 text-[var(--color-fg-subtle)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 9.75 9.75 15.75M9.75 9.75l6 6"
          />
        </svg>
      </div>
      <h2 className="text-[18px] font-medium text-[var(--color-fg)]">
        Sección deshabilitada
      </h2>
      <p className="max-w-md text-center text-[13px] text-[var(--color-fg-muted)]">
        Los bonos se otorgan al aprobar un depósito (seleccionando una
        plantilla) o manualmente desde el drawer del usuario. Todo se
        acredita al bonus_balance del jugador. La trazabilidad se ve en
        las transacciones del wallet.
      </p>
    </div>
  );
}
