export class MovementAlertNotFoundError extends Error {
  constructor(id: string) {
    super(`Alerta de movimiento ${id} no encontrada.`);
    this.name = 'MovementAlertNotFoundError';
  }
}

export class MovementAlertAlreadyResolvedError extends Error {
  constructor(id: string) {
    super(`La alerta ${id} ya fue confirmada o descartada.`);
    this.name = 'MovementAlertAlreadyResolvedError';
  }
}
