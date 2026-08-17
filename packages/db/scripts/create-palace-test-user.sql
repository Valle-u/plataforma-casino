-- Crear usuario de prueba para Palace Callback Testing
-- Correr en tenant_demo_dev
-- Nota: si tu cuenta de prueba en Palace tiene otro nombre, cambiá el valor
-- de `palace_account` por el real.

-- 1. Crear el usuario (si no existe)
INSERT INTO users (id, username, email, password_hash, display_name, status, palace_account)
VALUES (
  gen_random_uuid(),
  'testplayer',
  'testplayer@palace.test',
  '$argon2id$v=19$m=65536,t=3,p=4$placeholderhashforthistestuser000000000$placeholder',
  'Player Test',
  'active',
  'testplayer'
)
ON CONFLICT (username) DO UPDATE SET
  palace_account = 'testplayer',
  status = 'active',
  updated_at = now();

-- 2. Crear wallet con saldo (1000 fichas)
INSERT INTO wallets (id, user_id, balance, currency)
SELECT gen_random_uuid(), u.id, '1000.00', 'CHIPS'
FROM users u
WHERE u.username = 'testplayer'
ON CONFLICT (user_id) DO UPDATE SET
  balance = '1000.00',
  updated_at = now();
