-- Settings de Palace para tenant_demo_dev
INSERT INTO tenant_settings (key, value) VALUES
  ('palace.api_url',     '"https://agent.goldslotpalase.com"'::jsonb),
  ('palace.api_token',   '"be54f7ba-5a61-40bd-acd7-4f787fde182b"'::jsonb),
  ('palace.default_lang', '4'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
