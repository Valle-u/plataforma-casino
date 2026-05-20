/**
 * Errores del subsistema de leagues.
 */

export class LeagueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class LeagueNotFoundError extends LeagueError {
  constructor(id: string) {
    super(`League ${id} no existe.`);
  }
}

export class LeagueCodeConflictError extends LeagueError {
  constructor(code: string) {
    super(`Ya existe una league con code='${code}'.`);
  }
}

export class LeagueNotClosableError extends LeagueError {
  constructor(id: string, status: string) {
    super(`League ${id} no es cerrable (status=${status}). Solo 'active' se cierra.`);
  }
}

export class LeagueScheduleInvalidError extends LeagueError {
  constructor(reason: string) {
    super(`Schedule inválido: ${reason}`);
  }
}

export class LeagueMetricNotSupportedError extends LeagueError {
  constructor(metric: string) {
    super(
      `Metric '${metric}' aún no soportado para recompute. MVP: bet_volume, rounds_count.`,
    );
  }
}

/**
 * Sprint 51.2: solo `admin_tenant` puede crear leagues. Las ligas son
 * un servicio plataforma — los socios (independent o no) NO crean
 * ligas propias.
 */
export class LeagueActorRoleError extends LeagueError {
  constructor(public readonly actorUserId: string) {
    super(
      `User ${actorUserId} no puede crear/editar leagues: solo admin_tenant.`,
    );
  }
}
