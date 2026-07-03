-- F3 · Snapshot del issuer al crear withdrawal.
--
-- Sin esto, si el socio independiente se degrada (indep → dependiente / employee)
-- entre `create` y `markPaid` de un withdrawal, la resolución del issuer al
-- momento de pagar retorna una wallet distinta a la que estaba activa cuando
-- el player pidió el retiro → descuadre bank↔ledger.
--
-- Congelamos QUIÉN funde este withdrawal (wallet que recibirá las fichas del
-- player cuando markPaid ejecute) y QUIÉN es el operador dueño de esa rama.
--
-- Ambas columnas son NULLable:
--   - issuer_wallet_id: NULL en rows previas al F3 (no hay snapshot histórico).
--   - issuer_operator_user_id: NULL si el issuer resuelto era la Casa del
--     tenant (no hay operador indep dueño).
--
-- La resolución se hará en `withdrawals.service.create()`, y `markPaid` va a
-- preferir el snapshot cuando esté presente (fallback a resolución en vivo
-- para rows legacy).

ALTER TABLE "withdrawals"
  ADD COLUMN "issuer_wallet_id" uuid REFERENCES "wallets"("id") ON DELETE SET NULL,
  ADD COLUMN "issuer_operator_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "withdrawals"."issuer_wallet_id" IS
  'Snapshot al momento de create: wallet que va a RECIBIR las fichas del player cuando markPaid ejecute. Congela quién funde el withdrawal aunque la jerarquía cambie después. NULL en rows previas al F3.';
COMMENT ON COLUMN "withdrawals"."issuer_operator_user_id" IS
  'Snapshot al momento de create: user_id del operador indep dueño de la rama; NULL si el issuer resuelto era la Casa del tenant.';
