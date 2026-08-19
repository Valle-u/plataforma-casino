/**
 * Errores tipados del proveedor Forever.
 */

/** Falta configuración (settings) del tenant para operar con Forever. */
export class ForeverConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForeverConfigError';
  }
}

/** La Main API respondió con `status != 0` (o HTTP no-2xx). */
export class ForeverApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ForeverApiError';
  }
}
