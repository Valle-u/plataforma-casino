/**
 * Error de tope de apuesta (Blindaje núcleo, Parte B, B-build-4b).
 * Se lanza cuando una apuesta superaría el turnover mensual permitido.
 */
export class BettingCapExceededError extends Error {
  constructor(
    public readonly level: 'player' | 'global',
    public readonly cap: number,
    public readonly current: number,
  ) {
    super(
      `Se alcanzó el tope de apuesta mensual (${level === 'player' ? 'por jugador' : 'global'}): ${current} de ${cap}.`,
    );
    this.name = 'BettingCapExceededError';
  }
}
