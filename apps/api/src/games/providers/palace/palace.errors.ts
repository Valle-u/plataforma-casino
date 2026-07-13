/**
 * Errores tipados del módulo Palace.
 */

export class PalaceCallbackTokenInvalidError extends Error {
  constructor() {
    super('Callback token inválido');
    this.name = 'PalaceCallbackTokenInvalidError';
  }
}

export class PalaceTenantNotFoundError extends Error {
  constructor() {
    super('No se encontró un tenant con ese callback token');
    this.name = 'PalaceTenantNotFoundError';
  }
}

export class PalaceUserNotFoundError extends Error {
  constructor(public readonly account: string) {
    super(`Usuario con account '${account}' no encontrado`);
    this.name = 'PalaceUserNotFoundError';
  }
}

export class PalaceUserNotActiveError extends Error {
  constructor(public readonly account: string) {
    super(`Usuario '${account}' no está activo`);
    this.name = 'PalaceUserNotActiveError';
  }
}

export class PalaceInsufficientBalanceError extends Error {
  constructor(
    public readonly balance: string,
    public readonly amount: string,
  ) {
    super('Saldo insuficiente para la apuesta');
    this.name = 'PalaceInsufficientBalanceError';
  }
}

export class PalaceAlreadyProcessedError extends Error {
  balance: string | null = null;
  constructor(public readonly transGuid: string) {
    super(`Transacción ${transGuid} ya fue procesada`);
    this.name = 'PalaceAlreadyProcessedError';
  }
}

export class PalaceTransactionNotFoundError extends Error {
  constructor(public readonly transGuid: string) {
    super(`Transacción ${transGuid} no encontrada`);
    this.name = 'PalaceTransactionNotFoundError';
  }
}