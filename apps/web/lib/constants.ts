/**
 * Constantes del dominio que el frontend reusa en varios lugares.
 *
 * NO duplicar acá enums del backend que cambien dinámicamente. Los roles
 * son fijos (vienen del seed, mismos para todos los tenants), así que
 * está OK hardcodear. Si el día de mañana se permiten custom roles per
 * tenant, exponer endpoint `GET /tenant/roles` y bajar de ahí.
 */

export interface RoleOption {
  code: string;
  label: string;
  description: string;
  /**
   * Hint visual: rol "system" se pinta con badge danger. Los operativos
   * se pintan neutral. El rol `usuario_final` (jugador) se pinta info.
   */
  tone: 'system' | 'operational' | 'player';
}

/**
 * Roles del sistema — del seed `tenant-seed.ts`.
 * Orden: de mayor a menor jerarquía operativa.
 */
export const TENANT_ROLES: readonly RoleOption[] = [
  {
    code: 'admin_tenant',
    label: 'Admin Tenant',
    description: 'Acceso total. Mint/burn, settings, todo.',
    tone: 'system',
  },
  {
    code: 'socio',
    label: 'Socio',
    description: 'Puede gestionar su red de distribuidores y cajeros.',
    tone: 'operational',
  },
  {
    code: 'distribuidor',
    label: 'Distribuidor',
    description: 'Gestiona cajeros bajo su scope.',
    tone: 'operational',
  },
  {
    code: 'cajero',
    label: 'Cajero',
    description: 'Operación de wallet, depósitos y retiros de jugadores.',
    tone: 'operational',
  },
  {
    code: 'empleado',
    label: 'Empleado',
    description: 'Operación restringida. Sin scope sobre otros users.',
    tone: 'operational',
  },
  {
    code: 'usuario_final',
    label: 'Jugador',
    description: 'Cliente final. Sin permisos administrativos.',
    tone: 'player',
  },
] as const;

export type TenantRoleCode = (typeof TENANT_ROLES)[number]['code'];

/**
 * Rango jerárquico de cada rol (menor número = más privilegio). Define qué
 * roles puede CREAR un actor: solo los estrictamente por debajo del suyo. El
 * `admin_tenant` puede crear cualquiera. Espeja la lógica del backend en
 * `apps/api/src/tenant-auth/role-hierarchy.ts` — mantener en sync.
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
 * Roles que `actorRoleCodes` puede asignar al crear un usuario.
 *   - admin_tenant → todos (es el dueño del tenant; ve toda la estructura).
 *   - resto → solo los de rango estrictamente mayor (más abajo) que el suyo,
 *     para no exponer la jerarquía hacia arriba (un cajero no ve "socio"/
 *     "admin", un socio no ve "admin").
 *   - sin rol conocido → ninguno (default deny).
 *
 * Es solo UX/cosmético: el backend revalida en `POST /tenant/users`
 * (403 ROLE_NOT_ASSIGNABLE) — esto evita mostrar opciones que igual fallarían.
 */
export function assignableRoles(
  actorRoleCodes: readonly string[],
): RoleOption[] {
  if (actorRoleCodes.includes('admin_tenant')) return [...TENANT_ROLES];
  let best = Number.POSITIVE_INFINITY;
  for (const code of actorRoleCodes) {
    const r = ROLE_RANK[code];
    if (r !== undefined && r < best) best = r;
  }
  if (!Number.isFinite(best)) return [];
  return TENANT_ROLES.filter((r) => (ROLE_RANK[r.code] ?? Infinity) > best);
}

/**
 * Status válidos de un user (espejo del UpdateTenantUserDto del backend).
 */
// Nota: 'pending' existe en el enum de la DB pero se quitó de la UI (no hay
// flujo que lo use; nadie se crea pendiente). Se deja fuera de las opciones
// editables. Si algún registro viejo quedara 'pending', igual se muestra
// prolijo vía los mapas de labels (STATUS_LABEL/STATUS_TEXT).
export const USER_STATUSES = [
  { value: 'active', label: 'Activo' },
  { value: 'suspended', label: 'Suspendido' },
  { value: 'banned', label: 'Bloqueado' },
  { value: 'inactive', label: 'Inactivo' },
] as const;

export type UserStatus = (typeof USER_STATUSES)[number]['value'];
