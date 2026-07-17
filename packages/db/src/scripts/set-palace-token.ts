/**
 * set-palace-token — configura palace.api_url y palace.api_token en el
 * tenant demo (`tenant_demo_casino`) leyendo el token de una env var.
 *
 * Uso:
 *   PALACE_API_TOKEN=tu-token pnpm --filter @casino/db exec tsx src/scripts/set-palace-token.ts
 *
 * No commitea el token; el secreto solo vive en la env var / DB.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { tenantSettings, users } from '../index';

const DEMO = {
  dbName: 'tenant_demo_casino',
} as const;

async function main(): Promise<void> {
  const token = process.env.PALACE_API_TOKEN;
  if (!token || token.length === 0) {
    throw new Error('PALACE_API_TOKEN no está seteado.');
  }
  const apiUrl = process.env.PALACE_API_URL ?? 'https://agent.goldslotpalase.com';

  const template = process.env.DATABASE_URL_TENANT_TEMPLATE;
  if (!template) {
    throw new Error('DATABASE_URL_TENANT_TEMPLATE falta.');
  }

  const tenantUrl = template.replace('<tenant_db>', DEMO.dbName);
  const sql = postgres(tenantUrl, { max: 1 });
  const db = drizzle(sql);

  try {
    // Buscar un admin para marcar updated_by_user_id (best-effort).
    const adminRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'admin'))
      .limit(1);
    const adminId = adminRows[0]?.id ?? null;

    const now = new Date();
    const settings = [
      { key: 'palace.api_url', value: apiUrl },
      { key: 'palace.api_token', value: token },
      { key: 'palace.default_lang', value: 4 },
    ];

    for (const { key, value } of settings) {
      await db
        .insert(tenantSettings)
        .values({
          key,
          value,
          updatedByUserId: adminId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: tenantSettings.key,
          set: {
            value,
            updatedByUserId: adminId,
            updatedAt: now,
          },
        });
      console.log(`[set-palace-token] ${key} actualizado.`);
    }

    console.log('\n✓ Palace settings configurados para tenant demo.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[set-palace-token] FALLÓ:', err);
  process.exit(1);
});
