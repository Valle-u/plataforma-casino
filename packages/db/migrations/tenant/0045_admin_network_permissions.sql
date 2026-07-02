-- Comodín externo: permisos `*_admin_network` para un actor sin descendencia
-- jerárquica que actúa sobre TODA la red del admin (Casa + socios dependientes
-- + descendants), respetando el aislamiento de la sub-red del socio
-- independiente.
--
-- Patrón: igual que users.view_admin_network (0044). El ScopeGuard lee un
-- decorador `@AdminNetworkBypass('wallet.load_admin_network')` en el handler;
-- si el actor tiene el permiso Y el target ∈ red del admin (todos los users
-- del tenant − sub-red independiente) → deja pasar.
--
-- Todos delegables=TRUE (se otorgan por override al comodín).
-- NO se hace grant a ningún rol acá: el admin_tenant ya bypassea scope
-- jerárquicamente y no los necesita; el resto solo los recibe por override.

INSERT INTO permissions (code, category, description, audit_required, is_delegatable) VALUES
  ('wallet.load_admin_network',          'wallet',      'Cargar fichas a cualquier user de la red del admin (Casa + dependientes + descendants). NO alcanza a la sub-red del socio independiente. Otorgar por override al empleado comodín.',   TRUE, TRUE),
  ('wallet.unload_admin_network',        'wallet',      'Retirar fichas desde cualquier user de la red del admin hacia la wallet del actor. Reason obligatorio.',                                                                             TRUE, TRUE),
  ('wallet.view_admin_network',          'wallet',      'Ver wallet y transacciones de cualquier user de la red del admin (excluye sub-red del socio independiente). Alternativa a wallet.view_any para el comodín.',                        FALSE, TRUE),
  ('deposits.approve_admin_network',     'deposits',    'Aprobar depósitos pendientes de cualquier user de la red del admin (excluye sub-red del independiente).',                                                                            TRUE, TRUE),
  ('deposits.reject_admin_network',      'deposits',    'Rechazar depósitos pendientes de cualquier user de la red del admin.',                                                                                                                TRUE, TRUE),
  ('deposits.view_admin_network',        'deposits',    'Ver depósitos (listado + detalle + export) de la red del admin. Reemplaza a deposits.view_all para el comodín.',                                                                     FALSE, TRUE),
  ('withdrawals.approve_admin_network',  'withdrawals', 'Aprobar retiros pendientes de cualquier user de la red del admin.',                                                                                                                   TRUE, TRUE),
  ('withdrawals.reject_admin_network',   'withdrawals', 'Rechazar retiros pendientes de cualquier user de la red del admin.',                                                                                                                  TRUE, TRUE),
  ('withdrawals.process_admin_network',  'withdrawals', 'Marcar retiros como procesados/pagados en la red del admin.',                                                                                                                         TRUE, TRUE),
  ('withdrawals.view_admin_network',     'withdrawals', 'Ver retiros de la red del admin. Reemplaza a withdrawals.view_all para el comodín.',                                                                                                 FALSE, TRUE),
  ('bonuses.grant_manual_admin_network', 'bonuses',     'Otorgar bonos manuales a cualquier user de la red del admin.',                                                                                                                        TRUE, TRUE),
  ('bonuses.cancel_admin_network',       'bonuses',     'Cancelar bonos activos de cualquier user de la red del admin (revierte fichas al funder).',                                                                                           TRUE, TRUE)
ON CONFLICT (code) DO UPDATE SET
  category       = EXCLUDED.category,
  description    = EXCLUDED.description,
  audit_required = EXCLUDED.audit_required,
  is_delegatable = EXCLUDED.is_delegatable;
