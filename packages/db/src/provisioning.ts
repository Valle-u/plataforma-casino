/**
 * Helpers de provisioning de DBs de tenant.
 *
 * Cuando se crea un tenant nuevo, hay que ejecutar `CREATE DATABASE tenant_<slug>`
 * contra Postgres. Esto requiere conectarse a la DB admin (`postgres`) — no
 * podés hacer CREATE DATABASE estando conectado a la DB que querés crear.
 *
 * Uso:
 *   const adminUrl = deriveAdminUrl(process.env.DATABASE_URL_CONTROL!);
 *   await provisionTenantDatabase(adminUrl, 'tenant_demo_casino');
 */

import postgres from 'postgres';

/**
 * Convierte una URL Postgres apuntando a una DB X en una URL apuntando a `postgres`
 * (la DB admin que viene con cualquier instalación). Usada para ejecutar
 * CREATE DATABASE / DROP DATABASE.
 *
 * Ej: postgresql://user:pw@host:5432/platform_control
 *  →  postgresql://user:pw@host:5432/postgres
 */
export function deriveAdminUrl(connectionUrl: string): string {
  return connectionUrl.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1');
}

/**
 * Crea una DB Postgres si no existe.
 *
 * Idempotente: si ya existe, no falla — log y sigue.
 *
 * Valida el nombre de la DB (chars permitidos por Postgres) antes de armar
 * el SQL. CREATE DATABASE no acepta parámetros bind, así que tenemos que usar
 * SQL crudo y la validación es nuestra responsabilidad.
 *
 * @param adminUrl URL Postgres apuntando a la DB admin (típicamente 'postgres').
 * @param dbName Nombre de la DB a crear. Solo letras/dígitos/underscores.
 */
export async function provisionTenantDatabase(
  adminUrl: string,
  dbName: string,
): Promise<{ created: boolean; alreadyExisted: boolean }> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
    throw new Error(
      `Nombre de DB inválido (solo letras/dígitos/underscores, sin empezar con dígito): ${dbName}`,
    );
  }

  const sql = postgres(adminUrl, { max: 1 });

  try {
    await sql.unsafe(`CREATE DATABASE ${dbName}`);
    return { created: true, alreadyExisted: false };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === '42P04'
    ) {
      // 42P04 = duplicate_database
      return { created: false, alreadyExisted: true };
    }
    throw err;
  } finally {
    await sql.end();
  }
}
