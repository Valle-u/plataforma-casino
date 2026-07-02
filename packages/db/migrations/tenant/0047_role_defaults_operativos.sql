-- Defaults sensatos por rol (roadmap "roles paso a paso" — user session 2026-07).
--
-- Problema previo: el seed original solo asignaba a admin_tenant TODOS los
-- perms y a socio/distribuidor/cajero apenas 2 codes (reset_password + config
-- de comisiones). Efecto en producción: al loguearse como socio el nav mostraba
-- "casi nada" porque ninguno de sus perms operativos estaba grantee al rol.
-- Además la 0045 introdujo 12 permisos `*_admin_network` y NUNCA los granteó
-- al admin_tenant, por lo cual ni siquiera el admin podía delegarlos por
-- override → las planillas de empleado se recortaban silenciosamente.
--
-- Esta migración:
--   (A) Grantea los 12 codes `*_admin_network` al rol admin_tenant (fix del
--       bug de la 0045).
--   (B) Grantea al rol `socio` un set completo de perms operativos + de
--       delegación + de comisiones (mapa definido con el user).
--   (C) Grantea al rol `distribuidor` un subset del socio (sin delegación
--       de perms, sin configurar comisiones).
--   (D) Grantea al rol `cajero` un subset mínimo operativo (piso).
--   (E) Empleado y usuario_final quedan sin defaults (a la carta / self).
--
-- El ScopeGuard sigue enforceando que solo pueden operar sobre su descendencia
-- downstream — no hace falta restringir a nivel de permission.

BEGIN;

-- (A) admin_tenant — los 12 codes `*_admin_network` que faltaban.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, v.code
FROM roles r
CROSS JOIN (VALUES
  ('wallet.load_admin_network'),
  ('wallet.unload_admin_network'),
  ('wallet.view_admin_network'),
  ('deposits.approve_admin_network'),
  ('deposits.reject_admin_network'),
  ('deposits.view_admin_network'),
  ('withdrawals.approve_admin_network'),
  ('withdrawals.reject_admin_network'),
  ('withdrawals.process_admin_network'),
  ('withdrawals.view_admin_network'),
  ('bonuses.grant_manual_admin_network'),
  ('bonuses.cancel_admin_network')
) AS v(code)
WHERE r.code = 'admin_tenant'
ON CONFLICT DO NOTHING;

-- (B) socio (mini-casino delegado, alcance = red downstream)
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, v.code
FROM roles r
CROSS JOIN (VALUES
  -- Users
  ('users.view_any'),
  ('users.create'),
  ('users.edit'),
  ('users.ban'),
  ('users.reset_password'),
  ('users.export'),
  -- Wallet
  ('wallet.load'),
  ('wallet.unload'),
  ('wallet.view_any'),
  ('wallet.export'),
  -- Deposits
  ('deposits.view'),
  ('deposits.approve'),
  ('deposits.reject'),
  ('deposits.export'),
  -- Withdrawals
  ('withdrawals.view'),
  ('withdrawals.approve'),
  ('withdrawals.reject'),
  ('withdrawals.process'),
  ('withdrawals.export'),
  -- Bonuses (usa definitions del tenant, NO crea)
  ('bonuses.view'),
  ('bonuses.view_any'),
  ('bonuses.grant_manual'),
  ('bonuses.cancel'),
  ('bonuses.export'),
  -- Stats + audit + notifs (scoped a su red)
  ('wallet_stats.view_own_network'),
  ('wallet_stats.export'),
  ('game_stats.view_own_network'),
  ('game_stats.export'),
  ('audit.view'),
  ('notifications.view_any'),
  -- Commissions
  ('commissions.view'),
  ('commissions.configure_network'),
  -- Delegación (dentro de su red — el ScopeGuard restringe)
  ('permissions.grant'),
  ('permissions.revoke')
) AS v(code)
WHERE r.code = 'socio'
ON CONFLICT DO NOTHING;

-- (C) distribuidor (supervisor de cajeros — subset del socio)
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, v.code
FROM roles r
CROSS JOIN (VALUES
  -- Users (crea cajeros)
  ('users.view_any'),
  ('users.create'),
  ('users.edit'),
  ('users.ban'),
  ('users.reset_password'),
  ('users.export'),
  -- Wallet
  ('wallet.load'),
  ('wallet.unload'),
  ('wallet.view_any'),
  ('wallet.export'),
  -- Deposits
  ('deposits.view'),
  ('deposits.approve'),
  ('deposits.reject'),
  ('deposits.export'),
  -- Withdrawals
  ('withdrawals.view'),
  ('withdrawals.approve'),
  ('withdrawals.reject'),
  ('withdrawals.process'),
  ('withdrawals.export'),
  -- Bonuses
  ('bonuses.view'),
  ('bonuses.view_any'),
  ('bonuses.grant_manual'),
  ('bonuses.cancel'),
  ('bonuses.export'),
  -- Stats + audit + notifs
  ('wallet_stats.view_own_network'),
  ('game_stats.view_own_network'),
  ('audit.view'),
  ('notifications.view_any'),
  -- Commissions
  ('commissions.view')
  -- NO tiene: permissions.grant/revoke, commissions.configure_network
) AS v(code)
WHERE r.code = 'distribuidor'
ON CONFLICT DO NOTHING;

-- (D) cajero (piso operativo — mínimo)
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, v.code
FROM roles r
CROSS JOIN (VALUES
  -- Users (solo jugadores — canAssignRole bloquea crear cajeros)
  ('users.view_any'),
  ('users.create'),
  ('users.reset_password'),
  -- Wallet
  ('wallet.load'),
  ('wallet.unload'),
  ('wallet.view_any'),
  -- Deposits (aprueba/rechaza)
  ('deposits.view'),
  ('deposits.approve'),
  ('deposits.reject'),
  -- Withdrawals (aprueba/rechaza/procesa)
  ('withdrawals.view'),
  ('withdrawals.approve'),
  ('withdrawals.reject'),
  ('withdrawals.process'),
  -- Bonuses (otorga manuales)
  ('bonuses.view'),
  ('bonuses.grant_manual'),
  ('bonuses.cancel')
  -- NO tiene: exports, stats agregados, audit, delegación, commissions
) AS v(code)
WHERE r.code = 'cajero'
ON CONFLICT DO NOTHING;

-- (E) Los roles empleado y usuario_final no reciben ningún default.
-- Empleado: "a la carta" via planilla o override.
-- Usuario_final: no ve panel admin; sus operaciones son self-scoped en cada
-- endpoint (actor.id === target.id) — no requieren permission gate.

COMMIT;
