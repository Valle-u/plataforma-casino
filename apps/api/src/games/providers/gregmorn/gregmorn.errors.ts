/**
 * Errores tipados del proveedor Gregmorn (3er proveedor de juegos).
 *
 * Espeja `forever.errors.ts`. Ver docs/gregmorn/*.
 */

/** Falta configuración (settings) del tenant para operar con Gregmorn. */
export class GregmornConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GregmornConfigError';
  }
}

/**
 * La API de Gregmorn respondió con HTTP no-2xx o con `status: 'fail'`.
 *
 * `httpStatus` es el código HTTP; `code`/`error` son los campos del contrato de
 * error de ellos (`{ status, error, code, message }`), cuando vienen.
 */
export class GregmornApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
    public readonly code?: number,
    public readonly error?: string,
  ) {
    super(message);
    this.name = 'GregmornApiError';
  }
}
