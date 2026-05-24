/**
 * recompute-league-now.mjs — utility one-off para Sprint 53.1.
 * Recompute manual de standings de TODAS las ligas activas, replicando
 * la query de LeaguesService.computeScores (metric=bet_volume).
 *
 * Útil para forzar el podio actualizado entre ticks del cron (cada 5min).
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

const leagues = await sql`SELECT id, name, metric, starts_at, ends_at FROM leagues WHERE status='active'`;
console.log(`Found ${leagues.length} active leagues`);

for (const l of leagues) {
  if (l.metric !== 'bet_volume') {
    console.log(`  Skip "${l.name}" (metric=${l.metric} no soportado por este script)`);
    continue;
  }
  const rows = await sql`
    SELECT w.user_id, COALESCE(SUM(wt.amount), 0)::numeric AS score
    FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id
    WHERE wt.type = 'bet'
      AND wt.created_at >= ${l.starts_at}
      AND wt.created_at < ${l.ends_at}
    GROUP BY w.user_id
    ORDER BY SUM(wt.amount) DESC
  `;
  const now = new Date();
  const standings = rows.map((r, i) => ({
    league_id: l.id,
    user_id: r.user_id,
    position: i + 1,
    score: Number(r.score).toFixed(4),
    last_updated_at: now,
  }));
  if (standings.length > 0) {
    await sql`
      INSERT INTO league_standings ${sql(standings)}
      ON CONFLICT (league_id, user_id) DO UPDATE SET
        position = EXCLUDED.position,
        score = EXCLUDED.score,
        last_updated_at = EXCLUDED.last_updated_at
    `;
  }
  // Top 5 print
  const top = await sql`
    SELECT ls.position, u.username, ls.score
    FROM league_standings ls JOIN users u ON u.id = ls.user_id
    WHERE ls.league_id = ${l.id} ORDER BY ls.position ASC LIMIT 5
  `;
  console.log(`\n"${l.name}" → ${standings.length} standings upserted. Top 5:`);
  for (const row of top) {
    console.log(`  #${String(row.position).padStart(3)} ${row.username.padEnd(30)} ${row.score}`);
  }
}

await sql.end();
console.log('\nDone.');
