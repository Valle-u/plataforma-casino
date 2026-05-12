/**
 * Errores del dominio user-hierarchy.
 */

export class HierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Intento de asignar un user como su propio parent. */
export class SelfParentError extends HierarchyError {
  constructor() {
    super('Un user no puede ser su propio parent.');
  }
}

/**
 * Asignar un parent crearía un ciclo en la jerarquía. Ej: A→B y querés
 * asignar B→A.
 */
export class HierarchyCycleError extends HierarchyError {
  constructor(
    public readonly userId: string,
    public readonly parentUserId: string,
  ) {
    super(`Ciclo detectado: asignar ${parentUserId} como parent de ${userId} crearía una circular.`);
  }
}

/** El target del scope check no está dentro de la red del actor. */
export class OutOfScopeError extends HierarchyError {
  constructor(
    public readonly actorId: string,
    public readonly targetId: string,
  ) {
    super(`Target ${targetId} no está dentro de tu red (actor ${actorId}).`);
  }
}
