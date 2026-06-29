/**
 * Jerarquía de roles — define qué roles puede ASIGNAR un actor al crear o
 * editar usuarios, según su propio rango.
 *
 * Regla de negocio (el tenant es un árbol):
 *   admin_tenant → socio → distribuidor → cajero, con `empleado` y
 *   `usuario_final` como hojas que cualquier operador puede crear bajo su
 *   scope. Un actor solo puede asignar roles ESTRICTAMENTE por debajo del
 *   suyo: un socio no crea admins ni otros socios; un cajero no crea
 *   distribuidores. El `admin_tenant` es el dueño del tenant y puede asignar
 *   cualquier rol (mismo criterio que "el admin ve todo").
 *
 * Por qué vive acá y no solo en el front: `POST /tenant/users` y
 * `POST /tenant/users/:id/roles/:roleCode` solo exigen `users.create` /
 * `users.edit` — permisos que un socio puede tener. Sin este check un socio
 * podría mandar `roleCode: 'admin_tenant'` y autoescalar a admin. El dropdown
 * del front filtra por UX; la barrera REAL es server-side (defensa en
 * profundidad). Mantener en sync con `apps/web/lib/constants.ts`.
 */

/**
 * Rango jerárquico de cada rol del sistema. Menor número = más privilegio.
 * Mantener en sync con los roles del seed (`packages/db/src/seeds/tenant-seed.ts`).
 */
export const ROLE_RANK: Readonly<Record<string, number>> = {
  admin_tenant: 0,
  socio: 1,
  distribuidor: 2,
  cajero: 3,
  empleado: 4,
  usuario_final: 5,
};

/**
 * Rango efectivo del actor = el de su rol de MAYOR privilegio (mínimo rank).
 * Roles desconocidos se ignoran. Sin ningún rol conocido → +Infinity (sin
 * privilegio), que `canAssignRole` traduce a "no puede asignar nada".
 */
export function actorRank(actorRoleCodes: readonly string[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const code of actorRoleCodes) {
    const r = ROLE_RANK[code];
    if (r !== undefined && r < best) best = r;
  }
  return best;
}

/**
 * ¿El actor puede asignar `targetRoleCode` al crear/editar un usuario?
 *   - admin_tenant: cualquier rol conocido.
 *   - resto: solo roles de rango estrictamente mayor (más abajo) que el suyo.
 *   - target desconocido o actor sin rango → false (default deny).
 */
export function canAssignRole(
  actorRoleCodes: readonly string[],
  targetRoleCode: string,
): boolean {
  // Admin primero: puede asignar cualquier rol. Si el rol no existe, dejamos
  // que la validación de existencia del service responda 400 (no 403) — por
  // eso no chequeamos ROLE_RANK del target para el admin.
  if (actorRoleCodes.includes('admin_tenant')) return true;
  const targetRank = ROLE_RANK[targetRoleCode];
  if (targetRank === undefined) return false;
  const rank = actorRank(actorRoleCodes);
  if (!Number.isFinite(rank)) return false;
  return targetRank > rank;
}

/**
 * Lista de códigos de rol que el actor puede asignar. Útil para UI y tests.
 * Ordenada de mayor a menor privilegio (igual que ROLE_RANK).
 */
export function assignableRoleCodes(
  actorRoleCodes: readonly string[],
): string[] {
  return Object.keys(ROLE_RANK).filter((code) =>
    canAssignRole(actorRoleCodes, code),
  );
}
