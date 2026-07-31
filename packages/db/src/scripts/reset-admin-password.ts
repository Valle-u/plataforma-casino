import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users } from '../tenant';
import { hashPassword } from '../utils/password';

loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

function getTenantUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const template = process.env.DATABASE_URL_TENANT_TEMPLATE;
  if (!template) {
    throw new Error(
      'Falta conexión. Seteá DATABASE_URL (directo) o DATABASE_URL_TENANT_TEMPLATE.',
    );
  }
  const dbName = process.env.TENANT_DB_NAME ?? 'tenant_demo_dev';
  return template.replace('<tenant_db>', dbName);
}

async function main(): Promise<void> {
  const username = process.argv[2] ?? 'demo_admin';
  const newPassword = process.argv[3];
  if (!newPassword) {
    console.error(
      'Uso: pnpm --filter @casino/db db:reset:admin-password <username> <new-password>',
    );
    console.error(
      'Con DATABASE_URL seteada (la de Railway) o DATABASE_URL_TENANT_TEMPLATE en .env.local',
    );
    process.exit(1);
  }

  const url = getTenantUrl();
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const user = rows[0];
  if (!user) {
    console.error(`Usuario '${username}' no encontrado.`);
    await sql.end();
    process.exit(1);
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  console.log(`✓ Password actualizada para '${username}'.`);

  await sql.end();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
