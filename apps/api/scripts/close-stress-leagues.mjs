/**
 * close-stress-leagues.mjs — utility one-off.
 * Cierra las 50 ligas "Stress League #*" del stress-generator.
 * En MVP real hay ~1 liga activa, no 50 — esas 50 distorsionan
 * cualquier perf test (el cron recomputa todas cada minuto).
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

const r = await sql`
  UPDATE leagues SET status = 'closed', updated_at = NOW()
  WHERE code LIKE 'stress-league-%' AND status = 'active'
  RETURNING code
`;
console.log(`Cerradas ${r.length} ligas stress`);

const remaining = await sql`SELECT COUNT(*)::int AS n FROM leagues WHERE status = 'active'`;
console.log(`Ligas activas restantes: ${remaining[0].n}`);

await sql.end();
