-- =====================================================
-- Palace Casino — Configuración inicial del tenant
-- =====================================================
-- Correr una sola vez después de la migración 0064.
-- Cambiar los valores según tu cuenta real de Palace.
--
-- USO:
--   psql -U postgres -d platform_control -f scripts/setup-palace-settings.sql
--   psql -U postgres -d tenant_demo_dev -f scripts/setup-palace-settings.sql
--
-- O correr los comandos SQL uno por uno.
-- =====================================================

-- ── 1. Control DB: callback token del tenant ──
-- (Correr en platform_control)
-- Reemplazá <TENANT_ID> por el UUID de tu tenant.

UPDATE tenants
SET palace_callback_token = '1ff995a6-de36-4d69-803e-ca82b3688ae6'
WHERE id = '019f4dfb-3ec4-7502-9144-9e0a563b5a79';  -- demo (dev)

-- ── 2. Tenant DB: settings de Palace ──
-- (Correr en tenant_demo_dev)

INSERT INTO tenant_settings (key, value, updated_by_user_id)
VALUES
  ('palace.api_url',   '"https://agent.goldslotpalase.com"', NULL),
  ('palace.api_token', '"be54f7ba-5a61-40bd-acd7-4f787fde182b"', NULL),
  ('palace.default_lang', '4', NULL)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();
