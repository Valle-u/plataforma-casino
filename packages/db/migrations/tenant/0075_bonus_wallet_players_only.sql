-- LEYES (bonos, 2026-07-31): la wallet de bonos (wallets.bonus_balance) es
-- EXCLUSIVA de usuarios finales (rol `usuario_final`). Ningún operador
-- (socio/distribuidor/cajero/admin/empleado) debe tener bonus_balance.
--
-- Limpieza de datos históricos:
--   1. Reversa al funder el `remaining_amount` de cada user_bonus ACTIVO cuyo
--      target NO tiene rol `usuario_final` (wallet_tx `bonus_funding_revert`
--      en la wallet del funder + incremento de balance) y cancela el bono.
--   2. Deja `wallets.bonus_balance = 0` en toda wallet de un no-jugador que
--      haya quedado con residuo (consumo parcial / grants sin user_bonus),
--      registrando un `bonus_debit` por el monto restante.
--
-- Idempotencia: las wallet_tx llevan idempotency_key derivadas del id del
-- user_bonus / wallet, por lo que re-ejecutar la migración no duplica.

DO $$
DECLARE
  rec RECORD;
  funder_wallet_id UUID;
  funder_balance NUMERIC(20,2);
  target_wallet_id UUID;
  target_balance NUMERIC(20,2);
  target_bonus NUMERIC(20,2);
  now_ts timestamptz := now();
BEGIN
  -- ── 1. Reversar bonos activos de no-jugadores al funder ──────────────
  FOR rec IN
    SELECT ub.id AS user_bonus_id,
           ub.funded_by_user_id,
           ub.remaining_amount
    FROM user_bonuses ub
    WHERE ub.status = 'active'
      AND ub.remaining_amount > 0
      AND NOT EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ub.user_id
          AND r.code = 'usuario_final'
      )
  LOOP
    -- Wallet del funder (el grant siempre crea wallet del funder; defensivo).
    SELECT w.id, w.balance
      INTO funder_wallet_id, funder_balance
    FROM wallets w
    WHERE w.user_id = rec.funded_by_user_id
    FOR UPDATE;

    IF funder_wallet_id IS NULL THEN
      INSERT INTO wallets (user_id, balance, bonus_balance, locked_balance, currency, version)
      VALUES (rec.funded_by_user_id, '0', '0', '0', 'CHIPS', 0)
      RETURNING id, balance INTO funder_wallet_id, funder_balance;
    END IF;

    -- Devolver remaining_amount al funder.
    UPDATE wallets
    SET balance = balance + rec.remaining_amount,
        version = version + 1,
        updated_at = now_ts
    WHERE id = funder_wallet_id;

    INSERT INTO wallet_transactions (
      wallet_id, type, amount, balance_after, bonus_balance_after,
      source, idempotency_key, reason, created_by, created_at
    ) VALUES (
      funder_wallet_id, 'bonus_funding_revert', rec.remaining_amount,
      funder_balance + rec.remaining_amount, '0',
      'migration_0075',
      '0075_revert_funder:' || rec.user_bonus_id,
      'Reverso bono a operador (bonos solo usuarios finales)',
      NULL, now_ts
    );

    -- Cancelar el user_bonus.
    UPDATE user_bonuses
    SET status = 'cancelled',
        remaining_amount = '0',
        cancelled_at = now_ts,
        updated_at = now_ts
    WHERE id = rec.user_bonus_id;
  END LOOP;

  -- ── 2. Cero al bonus_balance residual de wallets de no-jugadores ─────
  FOR rec IN
    SELECT w.id AS wallet_id,
           w.user_id,
           w.balance,
           w.bonus_balance
    FROM wallets w
    WHERE w.bonus_balance > 0
      AND NOT EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = w.user_id
          AND r.code = 'usuario_final'
      )
    FOR UPDATE
  LOOP
    target_wallet_id := rec.wallet_id;
    target_balance := rec.balance;
    target_bonus := rec.bonus_balance;

    UPDATE wallets
    SET bonus_balance = '0',
        version = version + 1,
        updated_at = now_ts
    WHERE id = target_wallet_id;

    INSERT INTO wallet_transactions (
      wallet_id, type, amount, balance_after, bonus_balance_after,
      source, idempotency_key, reason, created_by, created_at
    ) VALUES (
      target_wallet_id, 'bonus_debit', target_bonus,
      target_balance, '0',
      'migration_0075',
      '0075_debit:' || target_wallet_id,
      'Quita bonus_balance de operador (bonos solo usuarios finales)',
      NULL, now_ts
    );
  END LOOP;
END $$;
