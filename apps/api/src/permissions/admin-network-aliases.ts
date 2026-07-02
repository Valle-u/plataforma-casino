/**
 * Aliases *_admin_network → permiso base.
 *
 * Un actor con `wallet.load_admin_network` (por override, el patrón del
 * comodín externo) debe pasar el gate `@RequirePermissions('wallet.load')`
 * sin tener explícitamente `wallet.load`. La restricción real (target ∈
 * red del admin) la hace el ScopeGuard después, vía @AdminNetworkBypass.
 *
 * Este mapa es CONSUMIDO por EffectivePermissionsService.calculateForUser
 * para expandir el set efectivo. La expansión es UNIDIRECCIONAL: tener
 * el alias implica el base (para pasar el gate), pero NO al revés.
 *
 * Precedente: users.view_admin_network (docs/03 §users, 0044).
 */

/**
 * Map alias → lista de permisos base. La lista contempla los casos donde
 * un mismo *_admin_network reemplaza a más de un permiso base:
 *  - `deposits.view_admin_network` implica pasar tanto el gate `deposits.view`
 *    (usado por el listado del cajero) como `deposits.view_all` (bypass en
 *    resolveScope). Análogo para withdrawals.view_admin_network.
 */
export const ADMIN_NETWORK_ALIASES: ReadonlyMap<string, readonly string[]> = new Map([
  ['wallet.load_admin_network', ['wallet.load']],
  ['wallet.unload_admin_network', ['wallet.unload']],
  ['wallet.view_admin_network', ['wallet.view_any']],
  ['deposits.approve_admin_network', ['deposits.approve']],
  ['deposits.reject_admin_network', ['deposits.reject']],
  ['deposits.view_admin_network', ['deposits.view', 'deposits.view_all']],
  ['withdrawals.approve_admin_network', ['withdrawals.approve']],
  ['withdrawals.reject_admin_network', ['withdrawals.reject']],
  ['withdrawals.process_admin_network', ['withdrawals.process']],
  ['withdrawals.view_admin_network', ['withdrawals.view', 'withdrawals.view_all']],
  ['bonuses.grant_manual_admin_network', ['bonuses.grant_manual']],
  ['bonuses.cancel_admin_network', ['bonuses.cancel']],
]);

/** Nombres de los permisos "admin_network" — útil para UI y helpers. */
export const ADMIN_NETWORK_PERMISSIONS: readonly string[] = Array.from(
  ADMIN_NETWORK_ALIASES.keys(),
);

/**
 * Expande in-place un set de permisos efectivos: por cada alias presente,
 * suma los permisos base al set. NO al revés (tener el base no implica el alias).
 */
export function expandAdminNetworkAliases(effective: Set<string>): void {
  for (const [alias, bases] of ADMIN_NETWORK_ALIASES.entries()) {
    if (effective.has(alias)) {
      for (const b of bases) effective.add(b);
    }
  }
}
