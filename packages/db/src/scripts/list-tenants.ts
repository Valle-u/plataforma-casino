/**
 * list-tenants — utilitario read-only: lista los tenants registrados en la
 * control DB (slug, db_name, status, domains) + las bases tenant_* que existen
 * en Postgres. Para saber con certeza qué resetear antes de algo destructivo.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { createControlDb, deriveAdminUrl, tenantDomains, tenants } from '../index';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) throw new Error('DATABASE_URL_CONTROL no seteada');
  const db = createControlDb(url);
  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      dbName: tenants.dbName,
      status: tenants.status,
    })
    .from(tenants);

  console.log('=== TENANTS registrados (control DB) ===');
  for (const t of rows) {
    const doms = await db
      .select({ domain: tenantDomains.domain })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, t.id));
    console.log(
      `  slug=${t.slug} | db=${t.dbName} | status=${t.status} | domains=[${doms
        .map((d) => d.domain)
        .join(', ')}]`,
    );
  }

  const adminSql = postgres(deriveAdminUrl(url), { max: 1 });
  try {
    const dbs = await adminSql<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE 'tenant_%' ORDER BY datname
    `;
    console.log('=== Bases tenant_* en Postgres ===');
    console.log('  ' + dbs.map((d) => d.datname).join(', '));
  } finally {
    await adminSql.end();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('FALLÓ:', err);
  process.exit(1);
});
