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
 * Status válidos de un user (espejo del UpdateTenantUserDto del backend).
 */
export const USER_STATUSES = [
  { value: 'active', label: 'Activo' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'suspended', label: 'Suspendido' },
  { value: 'banned', label: 'Bloqueado' },
] as const;

export type UserStatus = (typeof USER_STATUSES)[number]['value'];
