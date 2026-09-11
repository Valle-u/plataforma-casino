/**
 * Errores del subsistema de promociones / sorteos.
 */

export class PromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class PromotionNotFoundError extends PromotionError {
  constructor(id: string) {
    super(`Promotion ${id} no existe.`);
  }
}

export class PromotionNotActiveError extends PromotionError {
  constructor(id: string, status: string) {
    super(`Promotion ${id} no está activa (status=${status}).`);
  }
}

export class PromotionCodeConflictError extends PromotionError {
  constructor(code: string) {
    super(`Ya existe una promotion con code='${code}'.`);
  }
}

/** Tipo de promotion no compatible con la operación. */
export class PromotionTypeMismatchError extends PromotionError {
  constructor(id: string, expected: string, actual: string) {
    super(`Promotion ${id} es type='${actual}'; se esperaba '${expected}'.`);
  }
}

/** Schedule no permite la acción ahora (fuera de starts_at..ends_at). */
export class PromotionScheduleClosedError extends PromotionError {
  constructor(id: string) {
    super(`Promotion ${id} fuera del rango activo (starts_at/ends_at).`);
  }
}

/** El user ya tiene reward del key de idempotency (ya giró hoy, etc.). */
export class PromotionAlreadyClaimedError extends PromotionError {
  constructor(
    public readonly idempotencyKey: string,
  ) {
    super(`Promotion ya fue reclamada en este período (key=${idempotencyKey}).`);
  }
}

/** Config inválida del wheel (probabilidades no suman, segments vacíos). */
export class WheelConfigInvalidError extends PromotionError {
  constructor(reason: string) {
    super(`daily_wheel config inválida: ${reason}`);
  }
}

/** Funder sin saldo para pagar el premio. */
export class FunderInsufficientBalanceError extends PromotionError {
  constructor(
    public readonly funderUserId: string,
    public readonly required: string,
    public readonly available: string,
  ) {
    super(
      `Funder ${funderUserId} no tiene saldo (req=${required}, disp=${available}).`,
    );
  }
}

/**
 * Sprint 51.2: solo `admin_tenant` puede crear promotions. Las promociones
 * son un servicio plataforma — los socios (independent o no) NO crean
 * promotions propias.
 */
export class PromotionActorRoleError extends PromotionError {
  constructor(public readonly actorUserId: string) {
    super(
      `User ${actorUserId} no puede crear/editar promotions: solo admin_tenant.`,
    );
  }
}

// ── Elegibilidad para girar la ruleta (docs/27-ruleta-diaria.md §3) ─────────
//
// Cuatro errores y no uno genérico: cada uno se le muestra distinto al jugador
// y se investiga distinto. "No sos jugador" es un intento de un operador;
// "tu cuenta no está activa" es soporte; "no es para tu red" es E8 funcionando;
// "estás autoexcluido" no se le discute a nadie.

/** Sólo el rol `usuario_final` gira. Ni operadores, ni empleados, ni admin. */
export class WheelActorNotPlayerError extends PromotionError {
  constructor(public readonly actorUserId: string) {
    super(`User ${actorUserId} no puede girar: la ruleta es sólo de jugadores.`);
  }
}

/** Cuenta suspendida, baneada, pendiente o inactiva. */
export class WheelAccountNotActiveError extends PromotionError {
  constructor(
    public readonly actorUserId: string,
    public readonly status: string,
  ) {
    super(`User ${actorUserId} no puede girar: cuenta en status='${status}'.`);
  }
}

/**
 * LEY **E8** — el jugador cuelga de una sub-red independiente y los premios los
 * paga la Casa. Fondearlo sería que un actor externo fondee esa red.
 */
export class WheelIndependentNetworkError extends PromotionError {
  constructor(
    public readonly actorUserId: string,
    public readonly branchOwnerUserId: string,
  ) {
    super(
      `User ${actorUserId} no puede girar: cuelga de la red independiente ` +
        `${branchOwnerUserId} y la ruleta la paga la Casa (LEY E8).`,
    );
  }
}

/** Autoexclusión activa por juego responsable. */
export class WheelSelfExcludedError extends PromotionError {
  constructor(public readonly actorUserId: string) {
    super(`User ${actorUserId} no puede girar: tiene autoexclusión activa.`);
  }
}

/**
 * Premio `free_spins` — **fuera de alcance** (docs/27 §15).
 *
 * Existía como tipo configurable y el awarder no lo entregaba: logueaba un
 * warning, devolvía `null` y el reward se escribía igual. El jugador veía el
 * confetti y no recibía la tirada. Se bloquea en los dos extremos —al guardar
 * la config y al entregar— porque un premio que no se puede pagar no tiene que
 * poder existir.
 */
export class WheelFreeSpinsNotSupportedError extends PromotionError {
  constructor(public readonly segmentId?: string) {
    super(
      `Las tiradas gratis no están implementadas y no se pueden configurar` +
        (segmentId ? ` (segmento '${segmentId}')` : '') +
        `. Ver docs/27-ruleta-diaria.md §15.`,
    );
  }
}
