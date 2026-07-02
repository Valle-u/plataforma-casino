/**
 * `@AdminNetworkBypass(permissionCode)` — declara que este handler acepta
 * el bypass de scope "comodín externo": si el actor tiene el permiso
 * `*_admin_network` indicado, el ScopeGuard permite el target siempre que
 * caiga en la red del admin (todos los users del tenant − sub-red del
 * socio independiente).
 *
 * Uso:
 *   @RequirePermissions('wallet.load')
 *   @ScopeTarget('targetUserId', 'body')
 *   @AdminNetworkBypass('wallet.load_admin_network')
 *   async load(...) { ... }
 *
 * Semántica del ScopeGuard cuando este decorador está presente:
 *   1. sin @ScopeTarget → pass (nada que chequear).
 *   2. actor === target → pass.
 *   3. actor con rol admin_tenant → pass.
 *   4. target ∈ getActiveDescendants(actor) → pass.
 *   5. actor tiene el permiso *_admin_network Y target ∈ getAdminNetworkIds → pass (bypass admin_network).
 *   6. throw OUT_OF_SCOPE.
 *
 * El caso (5) es el que habilita al comodín (empleado sin descendencia)
 * a operar sobre toda la red del admin sin invadir la sub-red del socio
 * independiente.
 */

import { SetMetadata } from '@nestjs/common';

export interface AdminNetworkBypassMeta {
  permissionCode: string;
}

/**
 * Info del bypass que el ScopeGuard (o los callers de assertScopeAllowingAdminNetwork)
 * dejan sobre el request cuando el bypass admin_network dispara. El
 * AuditInterceptor puede persistirlo en la fila de audit para trazabilidad.
 */
export interface ScopeBypassInfo {
  kind: 'admin_network';
  perm: string;
}

export const ADMIN_NETWORK_BYPASS_KEY = 'adminNetworkBypass';

export const AdminNetworkBypass = (permissionCode: string): MethodDecorator =>
  SetMetadata(ADMIN_NETWORK_BYPASS_KEY, {
    permissionCode,
  } satisfies AdminNetworkBypassMeta);
