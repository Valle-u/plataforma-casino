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

const r = await sql`
  SELECT u.username, u.status, u.last_login_at, r.code AS role
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id
  WHERE r.code = 'usuario_final'
    AND u.username NOT LIKE 'stress_%'
  ORDER BY u.last_login_at DESC NULLS LAST
  LIMIT 10
`;
console.log('Real players (not stress):');
for (const row of r) {
  console.log(`  ${row.username.padEnd(30)} status=${row.status} last_login=${row.last_login_at?.toISOString() ?? 'never'}`);
}
await sql.end();
