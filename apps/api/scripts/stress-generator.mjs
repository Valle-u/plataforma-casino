/**
 * stress-generator.mjs — Sprint 51.12 (+ cleanup auto Sprint 54)
 *
 * Genera volumen sintético en `tenant_demo_dev` para stress-test los
 * endpoints + queries con dataset realista de "1-2 meses de tráfico
 * de un casino chico". Bulk INSERT via postgres-js direct (no Drizzle —
 * más rápido para >10k rows).
 *
 * Target additions:
 *   - 5k users + wallets
 *   - 50k wallet_transactions (mix de types, spread 30d)
 *   - 2k deposits aprobados (con audit + wallet_tx asociadas)
 *   - 50 leagues activas con 100 standings c/u
 *   - 10k notifications (mix sent/failed/pending/read)
 *   - 100k audit_log entries (acciones distribuidas)
 *
 * Reporte: tiempo por paso + counts finales.
 *
 * Cleanup auto de ligas (Sprint 54):
 *   Las 50 ligas que genera quedaban con status='active' y el
 *   LeaguesRecomputeCron las procesaba indefinidamente, distorsionando
 *   spike tests (Sprint 53.5 vio p95 2.7s con esto). Ahora el script
 *   trackea su RUN_ID y al final cierra SOLO las ligas que ese run creó
 *   (no toca ligas reales que tengan codes parecidos). Si el script
 *   crashea a mitad, el try/finally igual cierra lo que alcanzó a
 *   insertar.
 *
 *   Si necesitás cerrar ligas stress de runs viejos (por si alguna vez
 *   se rompió antes del fix), usá `close-stress-leagues.mjs`.
 *
 * Idempotente NO — agrega sobre existente. Para reset total: drop+restore
 * la DB usando el backup runbook.
 *
 * Uso:
 *   cd apps/api && node scripts/stress-generator.mjs
 */

import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.local') });

const TENANT_URL = (
  process.env.DATABASE_URL_TENANT_TEMPLATE ?? ''
).replace('<tenant_db>', 'tenant_demo_dev');
if (!TENANT_URL) {
  throw new Error('DATABASE_URL_TENANT_TEMPLATE missing in .env.local');
}

const sql = postgres(TENANT_URL, { max: 4 });

// ──────────────────────────────────────────────────────────────────────
// Tunables
// ──────────────────────────────────────────────────────────────────────

const USERS_TO_ADD = 5000;
const WALLET_TX_PER_USER = 10; // → 50k total
const DEPOSITS_TO_ADD = 2000;
const LEAGUES_TO_ADD = 50;
const STANDINGS_PER_LEAGUE = 100;
const NOTIFS_TO_ADD = 10000;
const AUDIT_ENTRIES_TO_ADD = 100000;

const BATCH = 500; // rows por INSERT

// RUN_ID único de este run del stress. Se embebe en el `code` de cada
// liga sintética y se usa al final para auto-cerrarlas (sin tocar ligas
// reales ni stress ligas de runs viejos).
const RUN_ID = Date.now();

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/** uuid v7-like: timestamp prefix + random. No es estrictamente v7 pero
 *  cumple el rol de "ordenable por tiempo" que necesitan los indexes. */
function uuid7() {
  return randomUUID();
}

/** Random ISO date entre `daysAgo` y ahora. */
function randomDateInLastDays(daysAgo) {
  const ms = Date.now() - Math.floor(Math.random() * daysAgo * 86400 * 1000);
  return new Date(ms);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function step(name, fn) {
  const t0 = Date.now();
  process.stdout.write(`[stress] ${name}… `);
  const result = await fn();
  const ms = Date.now() - t0;
  console.log(`OK (${ms}ms)${result ? ` ${result}` : ''}`);
  return ms;
}

// ──────────────────────────────────────────────────────────────────────
// Generación
// ──────────────────────────────────────────────────────────────────────

async function getPlayerRoleId() {
  const rows = await sql`SELECT id FROM roles WHERE code = 'usuario_final' LIMIT 1`;
  if (!rows[0]) throw new Error("Rol 'usuario_final' no encontrado");
  return rows[0].id;
}

async function getAdminId() {
  const rows = await sql`SELECT id FROM users WHERE username = 'demo_admin' LIMIT 1`;
  if (!rows[0]) throw new Error('demo_admin not found');
  return rows[0].id;
}

async function genUsersAndWallets() {
  const roleId = await getPlayerRoleId();
  const userIds = [];
  // Insert en batches.
  for (let i = 0; i < USERS_TO_ADD; i += BATCH) {
    const slice = [];
    const slot = Math.min(BATCH, USERS_TO_ADD - i);
    for (let j = 0; j < slot; j++) {
      const id = uuid7();
      userIds.push(id);
      const username = `stress_p${(i + j).toString().padStart(5, '0')}_${Math.random().toString(36).slice(2, 6)}`;
      slice.push({
        id,
        username: username.slice(0, 30),
        password_hash: '$argon2id$v=19$m=65536,t=3,p=4$fakefakefakefakefakefake$fakefakefakefakefakefakefakefakefakefakefake',
        display_name: username,
        status: 'active',
        created_at: randomDateInLastDays(30),
        updated_at: new Date(),
        last_login_at: Math.random() < 0.6 ? randomDateInLastDays(7) : null,
      });
    }
    await sql`INSERT INTO users ${sql(slice)}`;

    // user_roles
    const ur = slice.map((u) => ({ user_id: u.id, role_id: roleId, granted_at: new Date() }));
    await sql`INSERT INTO user_roles ${sql(ur)} ON CONFLICT DO NOTHING`;

    // wallets (1 per user)
    const ws = slice.map((u) => ({
      id: uuid7(),
      user_id: u.id,
      balance: (randInt(0, 50000) + Math.random()).toFixed(2),
      locked_balance: '0.00',
      currency: 'CHIPS',
      version: 1,
      created_at: u.created_at,
      updated_at: new Date(),
    }));
    await sql`INSERT INTO wallets ${sql(ws)}`;
  }
  return `${userIds.length} users + wallets`;
}

async function genWalletTransactions() {
  // Para inserts, necesitamos wallet_id existentes. Sampleamos los
  // wallets de los users nuevos (stress_*).
  const wallets = await sql`
    SELECT w.id, w.user_id, w.balance
    FROM wallets w JOIN users u ON u.id = w.user_id
    WHERE u.username LIKE 'stress_%'
  `;
  if (wallets.length === 0) throw new Error('No stress wallets found');

  const TYPES = [
    { type: 'mint', sign: 1, weight: 5 },
    { type: 'load', sign: 1, weight: 20 },
    { type: 'bet', sign: -1, weight: 30 },
    { type: 'win', sign: 1, weight: 20 },
    { type: 'transfer_in', sign: 1, weight: 5 },
    { type: 'transfer_out', sign: -1, weight: 5 },
    { type: 'deposit', sign: 1, weight: 8 },
    { type: 'withdrawal', sign: -1, weight: 4 },
    { type: 'bonus_grant', sign: 1, weight: 1 },
    { type: 'promo_reward', sign: 1, weight: 2 },
  ];
  const weighted = [];
  TYPES.forEach((t) => {
    for (let k = 0; k < t.weight; k++) weighted.push(t);
  });

  const TOTAL = USERS_TO_ADD * WALLET_TX_PER_USER;
  for (let i = 0; i < TOTAL; i += BATCH) {
    const slot = Math.min(BATCH, TOTAL - i);
    const slice = [];
    for (let j = 0; j < slot; j++) {
      const w = pick(wallets);
      const t = pick(weighted);
      const amount = (randInt(10, 5000) + Math.random()).toFixed(2);
      const dt = randomDateInLastDays(30);
      slice.push({
        id: uuid7(),
        wallet_id: w.id,
        type: t.type,
        amount,
        balance_after: w.balance, // approx; no tracking real para stress
        idempotency_key: `stress-${uuid7()}`,
        reason: `stress ${t.type}`,
        related_tx_id: null,
        source: 'stress',
        created_at: dt,
      });
    }
    await sql`INSERT INTO wallet_transactions ${sql(slice)} ON CONFLICT (idempotency_key) DO NOTHING`;
  }
  return `${TOTAL} wallet_transactions`;
}

async function genDeposits() {
  const wallets = await sql`
    SELECT w.id AS wallet_id, w.user_id
    FROM wallets w JOIN users u ON u.id = w.user_id
    WHERE u.username LIKE 'stress_%'
    LIMIT ${DEPOSITS_TO_ADD * 2}
  `;
  const methods = await sql`SELECT id FROM payment_methods WHERE is_active = true LIMIT 1`;
  if (!methods[0]) throw new Error('Sin payment_methods activos');
  const methodId = methods[0].id;
  const adminId = await getAdminId();

  const TOTAL = DEPOSITS_TO_ADD;
  for (let i = 0; i < TOTAL; i += BATCH) {
    const slot = Math.min(BATCH, TOTAL - i);
    const slice = [];
    for (let j = 0; j < slot; j++) {
      const w = pick(wallets);
      const dt = randomDateInLastDays(30);
      const amount = randInt(500, 5000).toFixed(2);
      slice.push({
        id: uuid7(),
        user_id: w.user_id,
        method_id: methodId,
        amount_chips: amount,
        amount_fiat: amount,
        currency_fiat: 'ARS',
        status: 'approved',
        receipt_url: 'https://stress.test/proof.png',
        receipt_storage_key: 'stress/proof.png',
        reviewed_by: adminId,
        reviewed_at: dt,
        created_at: dt,
        updated_at: dt,
      });
    }
    await sql`INSERT INTO deposits ${sql(slice)}`;
  }
  return `${TOTAL} deposits`;
}

async function genLeagues() {
  const now = new Date();
  const periodStart = new Date(now.getTime() - 7 * 86400 * 1000);
  const periodEnd = new Date(now.getTime() + 7 * 86400 * 1000);
  const adminId = await getAdminId();
  const leagueIds = [];
  const leagues = [];
  for (let i = 0; i < LEAGUES_TO_ADD; i++) {
    const id = uuid7();
    leagueIds.push(id);
    leagues.push({
      id,
      code: `stress-league-${i}-${RUN_ID}`,
      name: `Stress League #${i}`,
      period: 'custom',
      metric: 'bet_volume',
      metric_config: '{}',
      prizes: '{"1": {"kind": "chips", "amount": 10000}}',
      status: 'active',
      starts_at: periodStart,
      ends_at: periodEnd,
      visibility: '{}',
      funded_by_user_id: adminId,
      created_by_user_id: adminId,
      created_at: now,
      updated_at: now,
    });
  }
  await sql`INSERT INTO leagues ${sql(leagues)}`;

  // Standings: pick random users for each league.
  const userRows = await sql`
    SELECT id FROM users WHERE username LIKE 'stress_%' LIMIT 5000
  `;
  for (const leagueId of leagueIds) {
    const standings = [];
    for (let pos = 1; pos <= STANDINGS_PER_LEAGUE; pos++) {
      const u = pick(userRows);
      standings.push({
        id: uuid7(),
        league_id: leagueId,
        user_id: u.id,
        position: pos,
        score: (10000 - pos * 50 + Math.random() * 100).toFixed(4),
        computed_at: now,
      });
    }
    try {
      await sql`INSERT INTO league_standings ${sql(standings)} ON CONFLICT DO NOTHING`;
    } catch (err) {
      // unique violation por (league, user) — duplicado random, ignorable.
    }
  }
  return `${LEAGUES_TO_ADD} leagues + ~${LEAGUES_TO_ADD * STANDINGS_PER_LEAGUE} standings`;
}

async function genNotifications() {
  const userRows = await sql`
    SELECT id FROM users WHERE username LIKE 'stress_%' LIMIT 5000
  `;
  const STATUSES = ['sent', 'sent', 'sent', 'failed', 'pending', 'read'];
  const CHANNELS = ['in_app', 'in_app', 'email'];
  const KINDS = [
    'deposit_approved',
    'withdrawal_paid',
    'bonus_granted',
    'password_reset_by_admin',
    'fraud_cluster_detected',
    'welcome_bonus_blocked',
  ];

  for (let i = 0; i < NOTIFS_TO_ADD; i += BATCH) {
    const slot = Math.min(BATCH, NOTIFS_TO_ADD - i);
    const slice = [];
    for (let j = 0; j < slot; j++) {
      const u = pick(userRows);
      const status = pick(STATUSES);
      const ch = pick(CHANNELS);
      const kind = pick(KINDS);
      const dt = randomDateInLastDays(30);
      slice.push({
        id: uuid7(),
        user_id: u.id,
        kind,
        channel: ch,
        status,
        subject: `[stress] ${kind}`,
        body: `Stress notification body for ${kind}`,
        payload: '{}',
        error: status === 'failed' ? 'stress sim failure' : null,
        sent_at: status === 'sent' || status === 'read' ? dt : null,
        read_at: status === 'read' ? new Date(dt.getTime() + 60000) : null,
        created_at: dt,
      });
    }
    await sql`INSERT INTO notifications ${sql(slice)}`;
  }
  return `${NOTIFS_TO_ADD} notifications`;
}

async function genAuditLog() {
  const userRows = await sql`
    SELECT id, username FROM users WHERE username LIKE 'stress_%' LIMIT 5000
  `;
  const adminId = await getAdminId();
  const ACTIONS = [
    'deposits.create',
    'deposits.approve',
    'deposits.reject',
    'withdrawals.create',
    'withdrawals.approve',
    'wallet.load',
    'wallet.unload',
    'users.create',
    'users.update',
    'users.reset_password',
    'bonuses.grant_manual',
    'bonuses.cancel',
    'promotion.spin',
    'promotion.streak.claim',
    'league.recompute',
    'auth.login',
    'auth.logout',
  ];

  for (let i = 0; i < AUDIT_ENTRIES_TO_ADD; i += BATCH) {
    const slot = Math.min(BATCH, AUDIT_ENTRIES_TO_ADD - i);
    const slice = [];
    for (let j = 0; j < slot; j++) {
      const u = pick(userRows);
      const dt = randomDateInLastDays(30);
      const action = pick(ACTIONS);
      slice.push({
        id: uuid7(),
        actor_user_id: Math.random() < 0.5 ? adminId : u.id,
        actor_username: 'stress_actor',
        actor_role_at_time: 'usuario_final',
        action_code: action,
        target_type: 'user',
        target_id: u.id,
        before: null,
        after: '{}',
        reason: null,
        metadata: '{"severity":"low","stress":true}',
        ip: '127.0.0.1',
        user_agent: 'stress-test/1.0',
        request_id: uuid7(),
        session_id: null,
        impersonator_id: null,
        created_at: dt,
      });
    }
    await sql`INSERT INTO audit_log ${sql(slice)}`;
  }
  return `${AUDIT_ENTRIES_TO_ADD} audit entries`;
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

/**
 * Cierra las ligas sintéticas que este run creó (Sprint 54).
 *
 * Filtra por el RUN_ID embebido en el `code` para no tocar ligas reales
 * ni stress ligas de runs anteriores. Idempotente — si no creó ninguna
 * (porque el script crasheó antes del step de leagues), no hace nada.
 *
 * Llamado siempre desde `finally`, así que también corre si el script
 * crashea a la mitad. Las ligas creadas hasta el crash se cierran.
 */
async function cleanupSyntheticLeagues() {
  try {
    const result = await sql`
      UPDATE leagues
      SET status = 'closed', updated_at = NOW()
      WHERE code LIKE ${'stress-league-%-' + RUN_ID}
        AND status = 'active'
      RETURNING code
    `;
    if (result.length > 0) {
      console.log(
        `[stress] Cleanup: ${result.length} ligas sintéticas cerradas (run ${RUN_ID}).`,
      );
    }
  } catch (err) {
    console.error(
      `[stress] Cleanup leagues falló (no fatal — usá close-stress-leagues.mjs):`,
      err.message,
    );
  }
}

async function main() {
  console.log('========================================');
  console.log('  stress-generator — Sprint 51.12');
  console.log('========================================');
  console.log(`Run ID: ${RUN_ID}`);
  console.log(`Target: ${USERS_TO_ADD} users, ${USERS_TO_ADD * WALLET_TX_PER_USER} tx, ${DEPOSITS_TO_ADD} deposits,`);
  console.log(`        ${LEAGUES_TO_ADD} leagues, ${NOTIFS_TO_ADD} notifs, ${AUDIT_ENTRIES_TO_ADD} audit\n`);

  const t0 = Date.now();
  const times = {};
  const SKIP_STEP_1 = process.env.SKIP_USERS === '1';
  const SKIP_STEP_2 = process.env.SKIP_TX === '1';
  if (!SKIP_STEP_1) {
    times.users = await step('1/6 Users + wallets', genUsersAndWallets);
  } else {
    console.log('[stress] 1/6 Users + wallets… SKIPPED');
  }
  if (!SKIP_STEP_2) {
    times.tx = await step('2/6 Wallet transactions', genWalletTransactions);
  } else {
    console.log('[stress] 2/6 Wallet transactions… SKIPPED');
  }
  times.deposits = await step('3/6 Deposits', genDeposits);
  times.leagues = await step('4/6 Leagues + standings', genLeagues);
  times.notifs = await step('5/6 Notifications', genNotifications);
  times.audit = await step('6/6 Audit log', genAuditLog);
  const total = Date.now() - t0;

  console.log('\n========================================');
  console.log(`✓ Done in ${(total / 1000).toFixed(1)}s`);
  console.log('========================================');
  for (const [k, v] of Object.entries(times)) {
    console.log(`  ${k.padEnd(10)} ${(v / 1000).toFixed(1)}s`);
  }

  // Counts finales
  console.log('\n========================================');
  console.log('  Counts finales:');
  console.log('========================================');
  const finalCounts = await sql`
    SELECT 'users' AS t, COUNT(*)::text AS n FROM users
    UNION ALL SELECT 'wallets', COUNT(*)::text FROM wallets
    UNION ALL SELECT 'wallet_transactions', COUNT(*)::text FROM wallet_transactions
    UNION ALL SELECT 'deposits', COUNT(*)::text FROM deposits
    UNION ALL SELECT 'leagues', COUNT(*)::text FROM leagues
    UNION ALL SELECT 'league_standings', COUNT(*)::text FROM league_standings
    UNION ALL SELECT 'notifications', COUNT(*)::text FROM notifications
    UNION ALL SELECT 'audit_log', COUNT(*)::text FROM audit_log
  `;
  for (const r of finalCounts) {
    console.log(`  ${r.t.padEnd(22)} ${r.n.padStart(10)}`);
  }
}

(async () => {
  let exitCode = 0;
  try {
    await main();
  } catch (err) {
    console.error('FATAL:', err);
    exitCode = 1;
  } finally {
    // Cleanup auto: cierra las ligas sintéticas de este run para no
    // dejar trabajo basura al LeaguesRecomputeCron. Corre siempre,
    // incluso si main() crasheó.
    await cleanupSyntheticLeagues();
    await sql.end();
  }
  if (exitCode !== 0) process.exit(exitCode);
})();
