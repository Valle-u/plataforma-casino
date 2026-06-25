/**
 * Script: backfill de `user_hierarchy` para jugadores (`usuario_final`) que
 * quedaron huérfanos por el bug #3 — antes, `POST /tenant/users` solo
 * asignaba parent automático al rol `empleado`, no a `usuario_final`. Los
 * jugadores creados por un operador quedaban sin fila en `user_hierarchy`,
 * invisibles para su propia red (stats `view_own_network`) y fuera del
 * scope de su creador (403 OUT_OF_SCOPE al cargarles fichas).
 *
 * Para cada `usuario_final` SIN parent activo cuyo creador (el `granted_by`
 * del rol `usuario_final` en `user_roles`) es un operador NO-admin (cajero
 * / distribuidor / socio), inserta una fila activa colgándolo de su creador
 * con la convención `jugador_de_<rol>` (la misma precedencia que el fix en
 * el controller: socio > distribuidor > cajero). Salta:
 *   - los creados por `admin_tenant` (quedan root por diseño; el admin los
 *     ve vía `view_any` y colgarlos rompería el scope-filtering),
 *   - los que no tienen creador registrado (`granted_by` nulo),
 *   - los que ya tienen un parent activo.
 *
 * Idempotente: solo toca huérfanos, así que re-correrlo no duplica filas.
 *
 * Uso: pnpm --filter @casino/db db:backfill:player-hierarchy
 *      (corre sobre TODOS los tenants registrados en la DB de control)
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createControlDb, createTenantDb } from '../client';
import { tenants } from '../control';

loadEnv({ path: path.resolve(process.cwd(), '../../apps/api/.env.local') });

/**
 * INSERT...SELECT que re-parenta a los jugadores huérfanos. El `relation_type`
 * se deriva del rol de mayor jerarquía del creador; `admin_tenant` lo anula
 * (NULL) y esos no se insertan (WHERE relation_type IS NOT NULL).
 */
const BACKFILL_SQL = sql`
  WITH orphan_players AS (
    SELECT u.id AS user_id, ur.granted_by AS creator_id
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id AND r.code = 'usuario_final'
    WHERE ur.granted_by IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_hierarchy h
        WHERE h.user_id = u.id AND h.until IS NULL
      )
  ),
  with_relation AS (
    SELECT
      o.user_id,
      o.creator_id,
      CASE
        WHEN bool_or(cr.code = 'admin_tenant') THEN NULL
        WHEN bool_or(cr.code = 'socio') THEN 'jugador_de_socio'
        WHEN bool_or(cr.code = 'distribuidor') THEN 'jugador_de_distribuidor'
        WHEN bool_or(cr.code = 'cajero') THEN 'jugador_de_cajero'
        ELSE NULL
      END AS relation_type
    FROM orphan_players o
    JOIN user_roles cur ON cur.user_id = o.creator_id
    JOIN roles cr ON cr.id = cur.role_id
    GROUP BY o.user_id, o.creator_id
  )
  INSERT INTO user_hierarchy (id, user_id, parent_user_id, relation_type, since, created_by)
  SELECT gen_random_uuid(), wr.user_id, wr.creator_id, wr.relation_type, now(), wr.creator_id
  FROM with_relation wr
  WHERE wr.relation_type IS NOT NULL
  RETURNING user_id
`;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_CONTROL;
  if (!url) throw new Error('DATABASE_URL_CONTROL no definido.');

  const controlDb = createControlDb(url);
  const allTenants = await controlDb.select().from(tenants);

  if (allTenants.length === 0) {
    console.log('No hay tenants registrados.');
    return;
  }

  console.log(`Backfill de jerarquía de jugadores en ${allTenants.length} tenant(s)...`);
  let total = 0;
  for (const t of allTenants) {
    if (t.deletedAt !== null) {
      console.log(`  ⏭  ${t.slug} (deleted, skip)`);
      continue;
    }
    const tenantUrl = url.replace(/\/[^/?]+(\?.*)?$/, `/${t.dbName}$1`);
    process.stdout.write(`  ▶  ${t.slug} (${t.dbName})... `);
    try {
      const db = createTenantDb(tenantUrl);
      const rows = (await db.execute(BACKFILL_SQL)) as unknown as unknown[];
      const n = rows.length;
      total += n;
      console.log(`${n} jugador(es) re-parentado(s)`);
    } catch (err: unknown) {
      console.log('ERROR');
      console.error(err);
    }
  }
  console.log(`✅ Listo. ${total} jugador(es) re-parentado(s) en total.`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
