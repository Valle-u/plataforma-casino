/**
 * reset-cliente12-pwd.mjs — utilitario one-off para Sprint 53.1 live test.
 * Resetea la password de cliente12 a la misma que demo_admin (demo-pwd-2026)
 * copiando el hash. Permite loguear al test player desde el browser.
 *
 * Cambialo después con el flow normal de change password si querés.
 */
import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.local') });

const TENANT_URL = (process.env.DATABASE_URL_TENANT_TEMPLATE ?? '').replace(
  '<tenant_db>',
  'tenant_demo_dev',
);
const sql = postgres(TENANT_URL, { max: 2 });

const [admin] = await sql`SELECT password_hash FROM users WHERE username = 'demo_admin' LIMIT 1`;
if (!admin) throw new Error('demo_admin no encontrado');

const r = await sql`
  UPDATE users SET password_hash = ${admin.password_hash}, updated_at = NOW()
  WHERE username = 'cliente12'
  RETURNING username
`;
if (r.length === 0) throw new Error('cliente12 no encontrado');

console.log(`OK — password de cliente12 reseteada a "demo-pwd-2026" (igual que demo_admin)`);
await sql.end();
