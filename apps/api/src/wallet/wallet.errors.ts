/**
 * Errores del dominio wallet.
 *
 * Se mapean a HTTP en el controller (no en el service): el service tira
 * estos errores; el controller decide qué status code retornar. Esto deja
 * al service desacoplado del framework HTTP.
 */

export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * El wallet del actor no tiene saldo suficiente para la operación.
 *
 * `available` es el monto DISPONIBLE real (balance − locked_balance), no el
 * balance total: lo que está en hold (retiros pendientes, reservas) no es
 * gastable (LEYES E6). Cuando `locked > 0`, el rechazo es porque parte del
 * balance está comprometido en un hold — el controller lo mapea con
 * `reason: 'HOLD_LOCKED'` para que el front informe al admin.
 */
export class InsufficientBalanceError extends WalletError {
  constructor(
    public readonly available: string,
    public readonly required: string,
    public readonly locked: string | null = null,
  ) {
    const holdHint = locked && Number(locked) > 0 ? ` (${locked} en hold)` : '';
    super(`Saldo insuficiente: disponible=${available}${holdHint}, requerido=${required}.`);
  }
}

/** Otro proceso modificó el wallet entre nuestro read y nuestro write. */
export class WalletConcurrencyError extends WalletError {
  constructor(public readonly walletId: string) {
    super(`Wallet ${walletId} modificado por otro proceso. Reintentar.`);
  }
}

/** El wallet no existe (el user no tiene wallet creado todavía). */
export class WalletNotFoundError extends WalletError {
  constructor(public readonly userId: string) {
    super(`Wallet no existe para user ${userId}.`);
  }
}

/** Mint/burn intentado por alguien que no tiene el rol admin_tenant. */
export class MintRoleRequiredError extends WalletError {
  constructor() {
    super('Solo el rol admin_tenant puede ejecutar mint/burn.');
  }
}

/**
 * La misma idempotency key fue usada con una operación distinta
 * (amount/type/reason no matchean los originales). Doc `§11`.
 */
export class IdempotencyConflictError extends WalletError {
  constructor(public readonly key: string) {
    super(`Idempotency-Key "${key}" ya usada con parámetros distintos.`);
  }
}

/** Intento de transferir fichas de un wallet a sí mismo. */
export class SelfTransferError extends WalletError {
  constructor() {
    super('No podés transferir fichas a vos mismo.');
  }
}

/** El user target del load/unload no existe en el tenant. */
export class TargetUserNotFoundError extends WalletError {
  constructor(public readonly userId: string) {
    super(`User target ${userId} no existe en este tenant.`);
  }
}

/**
 * Load/Unload hacia un SOCIO INDEPENDIENTE (is_independent_branch=true).
 * Violaría E8/R4/P3: la sub-red independiente es un "casino aparte" que se
 * abastece comprando fichas (R4) — nunca recibe cargas por los botones
 * normales. El canal legítimo es la venta (branch_chip_sale).
 */
export class IndependentBranchTargetError extends WalletError {
  constructor(public readonly userId: string) {
    super(
      'Este socio es independiente: su stock entra por la venta de fichas (sección Sucursales), no por cargas manuales.',
    );
  }
}

/**
 * El issuer resuelto por HouseService (Casa o socio indep dueño de la rama del
 * player) no tiene saldo suficiente para fondear la operación (deposit, VIP
 * bonus, etc.). Es específico del flujo "issuer" para distinguirlo del
 * `InsufficientBalanceError` genérico y así el controller mapea 409 con payload
 * accionable (¿es la Casa? ¿es un socio indep? cuánto le falta).
 */
export class IssuerInsufficientBalanceError extends WalletError {
  constructor(
    public readonly issuerWalletId: string,
    public readonly issuerUserId: string | null,
    public readonly available: string,
    public readonly required: string,
    public readonly isCasa: boolean,
  ) {
    const who = isCasa ? 'la Casa' : `el socio ${issuerUserId ?? '?'}`;
    super(
      `Saldo del issuer insuficiente (${who}): disponible=${available}, requerido=${required}.`,
    );
  }
}
