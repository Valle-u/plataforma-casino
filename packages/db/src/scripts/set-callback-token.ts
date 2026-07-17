/**
 * set-callback-token — configura palace_callback_token en la DB de control
 * para un tenant dado. El token debe coincidir con el configurado en el
 * panel de Palace Casino.
 *
 * Uso:
 *   DATABASE_URL_CONTROL=... pnpm --filter @casino/db exec tsx src/scripts/set-callback-token.ts <token> [slug]
 *
 * Ejemplo:
 *   DATABASE_URL_CONTROL=... pnpm --filter @casino/db exec tsx src/scripts/set-callback-token.ts 1ff995a6-de36-4d69-803e-ca82b3688ae6 demo-casino
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import postgres from 'postgres';

loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) throw new Error('DATABASE_URL_CONTROL no definido.');

  const token = process.argv[2];
  if (!token) throw new Error('Token required as first argument');
  const slug = process.argv[3] || 'demo-casino';

  const sql = postgres(url, { max: 1 });
  try {
    const result = await sql`UPDATE tenants SET palace_callback_token = ${token} WHERE slug = ${slug} AND deleted_at IS NULL`;
    console.log(`[set-callback-token] Rows updated: ${result.count}`);

    const check = await sql`SELECT slug, palace_callback_token FROM tenants WHERE slug = ${slug}`;
    console.log(`[set-callback-token] Verified:`, JSON.stringify(check[0]));
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[set-callback-token] FALLÓ:', err);
    process.exit(1);
  });
