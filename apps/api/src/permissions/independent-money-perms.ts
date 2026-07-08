/**
 * Permisos de MOVER PLATA de un operador (cargar/descargar fichas + aprobar
 * depósitos/retiros).
 *
 * Modelo limpio (LEYES R3/R4): estos permisos NO viven en el rol
 * socio/distribuidor/cajero — un operador DEPENDIENTE es comercial puro y no
 * toca fichas (toda la plata central la manejan el admin + sus empleados). Se
 * otorgan SOLO a la sub-red INDEPENDIENTE:
 *   - el socio los recibe dentro del set completo de independencia
 *     (INDEPENDENT_BRANCH_AUTO_PERMISSIONS, en branches.service);
 *   - sus descendientes (distribuidores/cajeros) reciben exactamente estos, al
 *     activarse la sucursal (subtree auto-grant) y al crearse bajo una rama
 *     independiente (hook en tenant-users.controller).
 *
 * Los `.view`/`.export` NO están acá: ver la red es comercial (R2) y lo trae el
 * rol. Archivo hoja (sin imports de servicios) para que branches.service y
 * tenant-users.service lo compartan sin riesgo de ciclo.
 */
export const INDEPENDENT_OPERATOR_MONEY_PERMISSIONS = [
  'wallet.load',
  'wallet.unload',
  'deposits.approve',
  'deposits.reject',
  'withdrawals.approve',
  'withdrawals.reject',
  'withdrawals.process',
] as const;
