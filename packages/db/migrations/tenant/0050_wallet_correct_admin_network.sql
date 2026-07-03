-- F4: comodín `wallet.correct_admin_network` para el patrón admin_network.
--
-- Análogo a wallet.load_admin_network / deposits.approve_admin_network: un
-- empleado del admin sin descendencia jerárquica puede aplicar cargas por
-- corrección (docs/19) sobre cualquier user de la red del admin (Casa +
-- dependientes + descendants), pero NO sobre la sub-red del socio
-- independiente (aislamiento del modelo).
--
-- El ScopeGuard lo lee vía @AdminNetworkBypass('wallet.correct_admin_network')
-- en CorrectionController.apply. El alias se resuelve a `wallet.correct` en
-- admin-network-aliases.ts para pasar el gate @RequirePermissions('wallet.correct').
--
-- Delegable=TRUE (se otorga por override — no viene con ningún rol default).
-- audit_required=TRUE — la carga por corrección sigue teniendo audit severity high.

INSERT INTO permissions (code, category, description, audit_required, is_delegatable)
VALUES (
  'wallet.correct_admin_network',
  'wallet',
  'Corregir wallet de usuarios en la red del admin (admin_network). Alias de wallet.correct restringido: excluye sub-redes de socios independientes. Delegable.',
  TRUE,
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  category       = EXCLUDED.category,
  description    = EXCLUDED.description,
  audit_required = EXCLUDED.audit_required,
  is_delegatable = EXCLUDED.is_delegatable;
