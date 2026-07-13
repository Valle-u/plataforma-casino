-- Crear usuario de prueba "Tango" para Palace Callback Testing
-- Correr en tenant_demo_dev

-- 1. Crear el usuario (si no existe)
INSERT INTO users (id, username, email, password_hash, display_name, status, palace_account)
VALUES (
  gen_random_uuid(),
  'tango',
  'tango@palace.test',
  '$argon2id$v=19$m=65536,t=3,p=4$placeholderhashforthistestuser000000000$placeholder',
  'Tango Test',
  'active',
  'Tango'
)
ON CONFLICT (username) DO UPDATE SET
  palace_account = 'Tango',
  status = 'active',
  updated_at = now();

-- 2. Crear wallet con saldo (1000 fichas)
INSERT INTO wallets (id, user_id, balance, currency)
SELECT gen_random_uuid(), u.id, '1000.00', 'CHIPS'
FROM users u
WHERE u.username = 'tango'
ON CONFLICT (user_id) DO UPDATE SET
  balance = '1000.00',
  updated_at = now();