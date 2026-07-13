/**
 * Símbolos de inyección compartidos entre módulos.
 *
 * CONTROL_DB vive acá (no en database.module.ts) para evitar
 * dependencias circulares cuando múltiples módulos lo necesitan.
 */
export const CONTROL_DB = Symbol('CONTROL_DB');