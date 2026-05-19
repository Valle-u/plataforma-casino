/**
 * Helper de "panel access" — define cuáles roles tienen acceso al panel
 * admin del tenant vs cuáles son "player-only".
 *
 * Sprint 43 (security hardening): el sistema tenía UN endpoint de login
 * (`/tenant/auth/login`) sin discriminación de audience. Un usuario con
 * rol `usuario_final` (jugador) podía loguearse vía el form de admin y
 * recibir un JWT igual de válido que el del admin — accediendo al chrome
 * del panel admin y a los endpoints sin `@RequirePermissions`. Esto
 * cierra el agujero a nivel del set de roles.
 *
 * Definición operativa:
 *   - Roles "player-only" → set en `PLAYER_ROLE_CODES`. Hoy solo
 *     `usuario_final`. Si en el futuro hay más (ej. `usuario_final_vip`),
 *     se agregan acá.
 *   - Un usuario tiene "panel access" si tiene AL MENOS un rol que NO
 *     sea player-only. Multi-rol: admin que ALSO sea usuario_final tiene
 *     panel access (un admin puede jugar, defensa por permisos).
 *   - Un usuario sin ningún rol asignado se considera SIN panel access
 *     (default deny — caso anómalo, probablemente data corrupta).
 */

/**
 * Códigos de rol que NO dan acceso al panel admin. Roles "consumer-only".
 * Mantenerlo en sync con los seeds (`packages/db/src/seeds/tenant-seed.ts`).
 */
export const PLAYER_ROLE_CODES: readonly string[] = ['usuario_final'] as const;

/**
 * Devuelve true si el conjunto de roles del usuario incluye al menos uno
 * que NO sea player-only. Default deny: si el array está vacío, devuelve
 * false (sin roles = sin acceso).
 */
export function userHasPanelAccess(roleCodes: readonly string[]): boolean {
  if (roleCodes.length === 0) return false;
  return roleCodes.some((code) => !PLAYER_ROLE_CODES.includes(code));
}
