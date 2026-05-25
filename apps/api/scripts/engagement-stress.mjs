/**
 * engagement-stress.mjs — Sprint 53.1
 *
 * Stress test ESPECÍFICO de engagement: simula 200 players jugando,
 * ganando, perdiendo, con racha y wheel spin. Valida que el dataset
 * resultante alimente correctamente:
 *   - VIP tiers (cálculo de volume 30d)
 *   - Achievements predicates (sin disparar real, validamos lo que
 *     entraría — porque requiere login per-user)
 *   - League standings (los stress players aparecen)
 *   - Public wins feed (los wins se exponen vía endpoint)
 *   - Performance endpoints con engagement dataset
 *
 * No es bulk volume (eso lo hace stress-generator.mjs). Acá es FLOW
 * realista: cada player tiene rounds settled, wins, bonuses, etc. para
 * que cuando un humano abra el app player vea data viva.
 *
 * Idempotente: cleanupPrevious() corre al inicio de cada run, borra todos
 * los `stress_eng_%` y dependencias en orden FK-safe antes de generar
 * data fresca. Si querés solo limpiar (sin generar), `--cleanup`:
 *
 *   node scripts/engagement-stress.mjs --cleanup
 *
 * Uso normal:
 *   cd apps/api && node scripts/engagement-stress.mjs
 *
 * Pre-req: API arriba en :3000 + tenant_demo_dev seedeada + migrations
 * 0030+0031 aplicadas.
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

const API = 'http://127.0.0.1:3000';
const TENANT_HOST = 'demo.localhost';
const ADMIN_USER = 'demo_admin';
const ADMIN_PASS = 'demo-pwd-2026';

const sql = postgres(TENANT_URL, { max: 4 });

// ── Tunables ──────────────────────────────────────────────────────────
const PLAYERS_TO_ADD = 200;
const ROUNDS_MIN = 5;
const ROUNDS_MAX = 80;
const STREAK_PROBABILITY = 0.3; // 30% players con streak progress
const WHEEL_SPIN_PROBABILITY = 0.5; // 50% players con wheel spin del día

// ── Helpers ───────────────────────────────────────────────────────────

function uuid7() {
  return randomUUID();
}

function randomDateInLastDays(daysAgo) {
  const ms = Date.now() - Math.floor(Math.random() * daysAgo * 86400 * 1000);
  return new Date(ms);
}

function todayStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function todayUtcAnchor() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function step(name, fn) {
  const t0 = Date.now();
  process.stdout.write(`[eng] ${name}… `);
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    console.log(`OK ${ms}ms${result ? ` · ${result}` : ''}`);
    return { ms, result };
  } catch (err) {
    console.log(`\x1b[31mFAIL\x1b[0m: ${err.message}`);
    throw err;
  }
}

// ── Win distribution (matchea el LiveWinsTicker classifyAmount) ─────
function rollOutcome(bet) {
  const r = Math.random();
  if (r < 0.70) {
    // Lost
    return { won: 0, status: 'lost' };
  }
  if (r < 0.95) {
    // Small win 1.5x - 3x bet
    return { won: bet * (1.5 + Math.random() * 1.5), status: 'won_small' };
  }
  // Big win 8x - 50x bet → jackpot range
  return { won: bet * (8 + Math.random() * 42), status: 'won_jackpot' };
}

// ── Setup ─────────────────────────────────────────────────────────────

async function getPlayerRoleId() {
  const rows = await sql`SELECT id FROM roles WHERE code = 'usuario_final' LIMIT 1`;
  if (!rows[0]) throw new Error("Rol 'usuario_final' no encontrado");
  return rows[0].id;
}

async function getAdminId() {
  const rows = await sql`SELECT id FROM users WHERE username = 'demo_admin' LIMIT 1`;
  if (!rows[0]) throw new Error('demo_admin no encontrado');
  return rows[0].id;
}

async function getMockGame() {
  const rows = await sql`
    SELECT id, code, name, category FROM games
    WHERE code LIKE 'mock_%' AND is_active = true
    LIMIT 1
  `;
  if (!rows[0]) throw new Error('No hay mock games activos');
  return rows[0];
}

async function createPlayers() {
  const roleId = await getPlayerRoleId();
  const players = [];
  for (let i = 0; i < PLAYERS_TO_ADD; i++) {
    const id = uuid7();
    const username = `stress_eng_${i.toString().padStart(4, '0')}`;
    players.push({
      id,
      username,
      display_name: `Engagement Tester #${i}`,
      // Mismo hash que demo_admin (seed conocido, pero estos users NO
      // van a loguear — son solo data para el dataset).
      password_hash: '$argon2id$v=19$m=65536,t=3,p=4$fakefakefakefakefakefake$fakefakefakefakefakefakefakefakefakefakefake',
      status: 'active',
      created_at: randomDateInLastDays(30),
      updated_at: new Date(),
      last_login_at: randomDateInLastDays(7),
    });
  }

  await sql`INSERT INTO users ${sql(players)}`;

  // user_roles
  const ur = players.map((p) => ({
    user_id: p.id,
    role_id: roleId,
    granted_at: new Date(),
  }));
  await sql`INSERT INTO user_roles ${sql(ur)} ON CONFLICT DO NOTHING`;

  // wallets
  const ws = players.map((p) => ({
    id: uuid7(),
    user_id: p.id,
    balance: '5000.00',
    locked_balance: '0.00',
    currency: 'CHIPS',
    version: 1,
    created_at: p.created_at,
    updated_at: new Date(),
  }));
  await sql`INSERT INTO wallets ${sql(ws)}`;

  return players;
}

async function getStressWallets() {
  return sql`
    SELECT w.id AS wallet_id, w.user_id, w.balance, u.username
    FROM wallets w JOIN users u ON u.id = w.user_id
    WHERE u.username LIKE 'stress_eng_%'
  `;
}

/**
 * Genera game_rounds + bet/win wallet_tx por player. Esto es lo que
 * alimenta:
 *   - Public wins feed (rows con win_amount > 0 + status=settled)
 *   - VIP volume30d (sum |bet| en wallet_tx)
 *   - Achievements first_bet/first_win/volume_*
 *   - League standings (recompute al final via cron real o manual)
 */
async function generateGameActivity(players, mockGame, adminId) {
  let totalRounds = 0;
  let totalBets = 0;
  let totalWins = 0;
  let jackpotCount = 0;

  for (const player of players) {
    const wallet = await sql`
      SELECT id, balance FROM wallets WHERE user_id = ${player.id} LIMIT 1
    `;
    if (!wallet[0]) continue;
    let balance = Number(wallet[0].balance);
    const walletId = wallet[0].id;

    const rounds = randInt(ROUNDS_MIN, ROUNDS_MAX);
    // Crear session genérica.
    const sessionId = uuid7();
    const startedAt = randomDateInLastDays(30);
    const sessionRow = {
      id: sessionId,
      user_id: player.id,
      game_id: mockGame.id,
      provider_session_id: `eng-sess-${sessionId.slice(0, 8)}`,
      currency: 'CHIPS',
      status: 'closed',
      opened_balance: balance.toFixed(2),
      closing_balance: balance.toFixed(2), // se updatea después
      started_at: startedAt,
      ended_at: new Date(),
    };
    await sql`INSERT INTO game_sessions ${sql(sessionRow)} ON CONFLICT DO NOTHING`;

    const roundRows = [];
    const txRows = [];

    let sessionBetSum = 0;
    let sessionWinSum = 0;

    for (let r = 0; r < rounds; r++) {
      const bet = randInt(10, 500);
      if (balance < bet) break; // sin saldo, stop
      const outcome = rollOutcome(bet);
      const won = outcome.won > 0 ? Math.round(outcome.won) : 0;
      if (won > 10000) jackpotCount++;

      const settledAt = randomDateInLastDays(7);
      const betTxId = uuid7();
      const winTxId = won > 0 ? uuid7() : null;

      // Bet tx (debit) — balance_after = balance - bet
      balance -= bet;
      txRows.push({
        id: betTxId,
        wallet_id: walletId,
        type: 'bet',
        amount: bet.toFixed(2),
        balance_after: balance.toFixed(2),
        idempotency_key: `eng-bet-${betTxId}`,
        reason: `stress eng bet ${mockGame.code}`,
        related_tx_id: null,
        source: 'engagement_stress',
        created_at: settledAt,
      });

      // Win tx (credit) si ganó
      if (won > 0) {
        balance += won;
        txRows.push({
          id: winTxId,
          wallet_id: walletId,
          type: won >= 10000 ? 'jackpot_win' : 'win',
          amount: won.toFixed(2),
          balance_after: balance.toFixed(2),
          idempotency_key: `eng-win-${winTxId}`,
          reason: `stress eng win ${mockGame.code}`,
          related_tx_id: betTxId,
          source: 'engagement_stress',
          created_at: settledAt,
        });
        totalWins++;
      }

      sessionBetSum += bet;
      sessionWinSum += won;

      // game_round (status=settled)
      roundRows.push({
        id: uuid7(),
        session_id: sessionId,
        user_id: player.id,
        game_id: mockGame.id,
        round_external_id: `eng-r-${uuid7()}`,
        bet_amount: bet.toFixed(2),
        win_amount: won.toFixed(2),
        net_amount: (won - bet).toFixed(2),
        status: 'settled',
        bet_wallet_tx_id: betTxId,
        win_wallet_tx_id: winTxId,
        payload: { outcome: outcome.status },
        placed_at: settledAt,
        settled_at: settledAt,
      });
      totalBets++;
      totalRounds++;
    }

    if (txRows.length > 0) {
      await sql`INSERT INTO wallet_transactions ${sql(txRows)} ON CONFLICT (idempotency_key) DO NOTHING`;
    }
    if (roundRows.length > 0) {
      await sql`INSERT INTO game_rounds ${sql(roundRows)} ON CONFLICT DO NOTHING`;
    }

    // Update wallet balance + session totals
    await sql`
      UPDATE wallets SET balance = ${balance.toFixed(2)}, version = version + 1, updated_at = NOW()
      WHERE id = ${walletId}
    `;
    await sql`
      UPDATE game_sessions
      SET closing_balance = ${balance.toFixed(2)}
      WHERE id = ${sessionId}
    `;
    // sessionBetSum / sessionWinSum no se persisten — game_sessions schema
    // no tiene esas columnas. Se calculan desde game_rounds si hace falta.
    void sessionBetSum;
    void sessionWinSum;
  }

  return `${totalRounds} rounds, ${totalBets} bets, ${totalWins} wins (${jackpotCount} jackpots)`;
}

/**
 * Mete progress de login_streak en `promotion_participants` para una
 * fracción aleatoria de players. Esto alimenta el achievement streak_3
 * y streak_7.
 */
async function generateStreaks(players) {
  const streakPromos = await sql`
    SELECT id FROM promotions WHERE type = 'login_streak' AND status = 'active' LIMIT 1
  `;
  if (!streakPromos[0]) {
    return '(sin login_streak activo, skip)';
  }
  const promoId = streakPromos[0].id;
  const todayA = todayUtcAnchor();

  const rows = [];
  for (const p of players) {
    if (Math.random() > STREAK_PROBABILITY) continue;
    const streak = randInt(1, 10); // 1-10 day streak
    rows.push({
      id: uuid7(),
      promotion_id: promoId,
      user_id: p.id,
      // postgres-js serializa objects → jsonb automaticamente. Si pasamos
      // JSON.stringify, lo guarda como text en jsonb (queryable pero
      // con `->>` raro). Mejor pasar el objeto directo.
      current_progress: {
        streak,
        lastClaimDay: streak > 0 ? todayA : null,
      },
      joined_at: new Date(),
      updated_at: new Date(),
    });
  }
  if (rows.length === 0) return '(0 streaks)';

  await sql`
    INSERT INTO promotion_participants ${sql(rows)}
    ON CONFLICT (promotion_id, user_id) DO UPDATE SET
      current_progress = EXCLUDED.current_progress,
      updated_at = NOW()
  `;
  return `${rows.length} streak progresses`;
}

/**
 * Crea promotion_reward del daily wheel del día para una fracción de
 * players → activa el achievement wheel_spin_today.
 */
async function generateWheelSpins(players) {
  const wheelPromos = await sql`
    SELECT id, funded_by_user_id, code FROM promotions
    WHERE type = 'daily_wheel' AND status = 'active' LIMIT 1
  `;
  if (!wheelPromos[0]) {
    return '(sin daily_wheel activo, skip)';
  }
  const promo = wheelPromos[0];
  const todayA = todayUtcAnchor();

  const rewardRows = [];
  const walletTxRows = [];
  const fundedWallet = await sql`
    SELECT id FROM wallets WHERE user_id = ${promo.funded_by_user_id} LIMIT 1
  `;
  if (!fundedWallet[0]) return '(funder sin wallet, skip)';

  for (const p of players) {
    if (Math.random() > WHEEL_SPIN_PROBABILITY) continue;
    const playerWallet = await sql`
      SELECT id FROM wallets WHERE user_id = ${p.id} LIMIT 1
    `;
    if (!playerWallet[0]) continue;
    const won = randInt(50, 500);
    const idemKey = `eng-wheel-${uuid7()}`;

    // promo_reward wallet_tx para el player (es el que enciende
    // wheel_spin_today predicate).
    const walletTxId = uuid7();
    walletTxRows.push({
      id: walletTxId,
      wallet_id: playerWallet[0].id,
      type: 'promo_reward',
      amount: won.toFixed(2),
      balance_after: '0.00', // approximate
      idempotency_key: idemKey,
      reason: `stress eng wheel spin`,
      related_tx_id: null,
      source: 'engagement_stress',
      created_at: new Date(),
    });

    // promotion_rewards row con metadata.dayAnchor = today
    rewardRows.push({
      id: uuid7(),
      promotion_id: promo.id,
      user_id: p.id,
      prize: { kind: 'chips', amount: won },
      wallet_tx_id: walletTxId,
      bonus_id: null,
      idempotency_key: `eng-wheelspin-${p.id}-${todayA}`,
      metadata: { dayAnchor: todayA, segmentId: 'stress' },
      granted_at: new Date(),
    });
  }

  if (walletTxRows.length > 0) {
    await sql`INSERT INTO wallet_transactions ${sql(walletTxRows)} ON CONFLICT (idempotency_key) DO NOTHING`;
  }
  if (rewardRows.length > 0) {
    // Unique constraint es (promotion_id, idempotency_key) — omitimos ON
    // CONFLICT, el cleanup previo garantiza no duplicates.
    await sql`INSERT INTO promotion_rewards ${sql(rewardRows)}`;
  }

  return `${rewardRows.length} wheel spins`;
}

/**
 * Trigger achievement check + VIP recompute para una muestra de players
 * via SQL directo (replicando la lógica del service — más rápido que
 * loguear y hacer HTTP por player).
 *
 * Solo replicamos VIP recompute acá (es 1 upsert por user). Achievements
 * los chequeamos con queries de validación al final.
 */
async function recomputeAllVipTiers(playerIds) {
  const tiers = await sql`SELECT code, threshold_chips FROM vip_tiers ORDER BY threshold_chips ASC`;
  if (tiers.length === 0) {
    return '(vip_tiers vacío — migration 0031 aplicada?)';
  }

  // Calcular volume 30d por player en una sola query agregada.
  const volumes = await sql`
    SELECT w.user_id, COALESCE(SUM(CASE WHEN wt.type = 'bet' THEN wt.amount ELSE 0 END), 0)::numeric AS vol
    FROM wallets w
    LEFT JOIN wallet_transactions wt
      ON wt.wallet_id = w.id
      AND wt.created_at >= NOW() - INTERVAL '30 days'
    WHERE w.user_id IN ${sql(playerIds)}
    GROUP BY w.user_id
  `;

  const rows = volumes.map((v) => {
    const vol = Number(v.vol);
    // Tier highest threshold <= vol
    let tier = tiers[0];
    for (const t of tiers) {
      if (vol >= Number(t.threshold_chips)) tier = t;
    }
    return {
      user_id: v.user_id,
      current_tier_code: tier.code,
      volume_30d: vol.toFixed(2),
      recomputed_at: new Date(),
    };
  });

  if (rows.length === 0) return '(no players)';

  await sql`
    INSERT INTO user_vip_status ${sql(rows)}
    ON CONFLICT (user_id) DO UPDATE SET
      current_tier_code = EXCLUDED.current_tier_code,
      volume_30d = EXCLUDED.volume_30d,
      recomputed_at = EXCLUDED.recomputed_at
  `;
  return `${rows.length} vip statuses upserted`;
}

// ──────────────────────────────────────────────────────────────────────
// Validaciones SQL agregadas
// ──────────────────────────────────────────────────────────────────────

async function reportVipDistribution() {
  const rows = await sql`
    SELECT uvs.current_tier_code AS tier, COUNT(*)::int AS n
    FROM user_vip_status uvs
    JOIN users u ON u.id = uvs.user_id
    WHERE u.username LIKE 'stress_eng_%'
    GROUP BY uvs.current_tier_code
    ORDER BY uvs.current_tier_code
  `;
  return rows;
}

async function reportAchievementPredicateMatches() {
  // Para cada predicate, contamos cuántos stress players lo cumplirían.
  // No insertamos en user_achievements (eso requiere mintear chips —
  // mejor hacerlo via real check del backend cuando el player loguea).
  const baseUsers = await sql`
    SELECT id FROM users WHERE username LIKE 'stress_eng_%'
  `;
  const userIds = baseUsers.map((u) => u.id);
  if (userIds.length === 0) return [];

  const result = [];

  const [{ first_bet }] = await sql`
    SELECT COUNT(DISTINCT w.user_id)::int AS first_bet
    FROM wallets w JOIN wallet_transactions wt ON wt.wallet_id = w.id
    WHERE w.user_id IN ${sql(userIds)} AND wt.type = 'bet'
  `;
  result.push({ code: 'first_bet', matches: first_bet });

  const [{ first_win }] = await sql`
    SELECT COUNT(DISTINCT w.user_id)::int AS first_win
    FROM wallets w JOIN wallet_transactions wt ON wt.wallet_id = w.id
    WHERE w.user_id IN ${sql(userIds)} AND wt.type IN ('win','jackpot_win')
  `;
  result.push({ code: 'first_win', matches: first_win });

  for (const [code, threshold] of [
    ['volume_1k', 1000],
    ['volume_10k', 10000],
    ['volume_100k', 100000],
  ]) {
    const [{ n }] = await sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT w.user_id, COALESCE(SUM(wt.amount), 0)::numeric AS vol
        FROM wallets w
        LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id AND wt.type = 'bet'
        WHERE w.user_id IN ${sql(userIds)}
        GROUP BY w.user_id
        HAVING COALESCE(SUM(wt.amount), 0) >= ${threshold}
      ) t
    `;
    result.push({ code, matches: n });
  }

  // streak_3 / streak_7
  const streakUsers = await sql`
    SELECT pp.user_id, (pp.current_progress->>'streak')::int AS streak
    FROM promotion_participants pp
    JOIN promotions p ON p.id = pp.promotion_id
    WHERE p.type = 'login_streak' AND pp.user_id IN ${sql(userIds)}
  `;
  result.push({
    code: 'streak_3',
    matches: streakUsers.filter((s) => (s.streak ?? 0) >= 3).length,
  });
  result.push({
    code: 'streak_7',
    matches: streakUsers.filter((s) => (s.streak ?? 0) >= 7).length,
  });

  // wheel_spin_today
  const today = todayStart();
  const [{ wheel_today }] = await sql`
    SELECT COUNT(DISTINCT w.user_id)::int AS wheel_today
    FROM wallets w JOIN wallet_transactions wt ON wt.wallet_id = w.id
    WHERE w.user_id IN ${sql(userIds)}
      AND wt.type = 'promo_reward'
      AND wt.created_at >= ${today}
  `;
  result.push({ code: 'wheel_spin_today', matches: wheel_today });

  // VIP tier matches (silver/gold/platinum)
  const vipDist = await reportVipDistribution();
  for (const code of ['silver', 'gold', 'platinum']) {
    const cumul = vipDist
      .filter((r) => {
        const rank = { silver: 1, gold: 2, platinum: 3 }[r.tier] ?? 0;
        const need = { silver: 1, gold: 2, platinum: 3 }[code] ?? 99;
        return rank >= need;
      })
      .reduce((sum, r) => sum + r.n, 0);
    result.push({ code: `vip_${code}`, matches: cumul });
  }

  return result;
}

async function reportPublicWinsCount() {
  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n
    FROM game_rounds
    WHERE status = 'settled' AND win_amount > 0
  `;
  return n;
}

async function reportTopLeagueStandings() {
  const league = await sql`
    SELECT id, name FROM leagues WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1
  `;
  if (!league[0]) return { leagueName: null, top: [] };
  const top = await sql`
    SELECT ls.position, u.username, ls.score
    FROM league_standings ls
    JOIN users u ON u.id = ls.user_id
    WHERE ls.league_id = ${league[0].id}
    ORDER BY ls.position ASC
    LIMIT 10
  `;
  return { leagueName: league[0].name, top };
}

// ──────────────────────────────────────────────────────────────────────
// HTTP validation
// ──────────────────────────────────────────────────────────────────────

async function loginAdmin() {
  const res = await fetch(`${API}/tenant/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Host': TENANT_HOST },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).accessToken;
}

async function timeEndpoint(token, label, path) {
  const samples = [];
  let lastStatus = 0;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const res = await fetch(`${API}${path}`, {
      headers: {
        'X-Tenant-Host': TENANT_HOST,
        Authorization: `Bearer ${token}`,
      },
    });
    await res.text();
    samples.push(performance.now() - t0);
    lastStatus = res.status;
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples.at(-1);
  return { label, path, status: lastStatus, p50, p95 };
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function cleanupPrevious() {
  // Borra todos los stress_eng_* y sus dependencias.
  // wallet_transactions y game_rounds NO tienen ON DELETE CASCADE (append-only
  // por design), así que los borramos a mano primero. game_sessions sí
  // CASCADE desde user (lo dejamos al CASCADE final).
  //
  // Orden: las refs más profundas primero. game_rounds referencia
  // wallet_transactions vía bet_wallet_tx_id (sin CASCADE), por eso van
  // antes los rounds que las txs.
  await sql`DELETE FROM user_vip_status WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'stress_eng_%')`;
  await sql`DELETE FROM promotion_participants WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'stress_eng_%')`;
  await sql`DELETE FROM promotion_rewards WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'stress_eng_%')`;
  await sql`DELETE FROM user_achievements WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'stress_eng_%')`;
  await sql`DELETE FROM game_rounds WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'stress_eng_%')`;
  await sql`DELETE FROM game_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'stress_eng_%')`;
  await sql`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT w.id FROM wallets w JOIN users u ON u.id = w.user_id WHERE u.username LIKE 'stress_eng_%')`;
  await sql`DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'stress_eng_%')`;
  await sql`DELETE FROM users WHERE username LIKE 'stress_eng_%'`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ENGAGEMENT STRESS — Sprint 53.1');
  console.log('═══════════════════════════════════════════════════════');
  console.log();

  const adminId = await getAdminId();
  const mockGame = await getMockGame();
  console.log(`  Mock game: ${mockGame.name} (${mockGame.code})`);
  console.log();

  await step('Cleanup previous stress_eng_* (idempotency)', async () => {
    await cleanupPrevious();
  });

  let players = [];
  await step('Crear players + wallets', async () => {
    players = await createPlayers();
    return `${players.length} players`;
  });

  await step('Generar game rounds (con bet+win wallet_tx)', async () =>
    generateGameActivity(players, mockGame, adminId),
  );

  await step('Generar streak progress', async () =>
    generateStreaks(players),
  );

  await step('Generar wheel spins del día', async () =>
    generateWheelSpins(players),
  );

  await step('Recompute VIP tiers', async () =>
    recomputeAllVipTiers(players.map((p) => p.id)),
  );

  console.log();
  console.log('───────────────────────────────────────────────────────');
  console.log('  REPORTE');
  console.log('───────────────────────────────────────────────────────');
  console.log();

  // VIP distribution
  const vip = await reportVipDistribution();
  console.log('  VIP tier distribution (stress_eng_*):');
  for (const row of vip) {
    console.log(`    ${row.tier.padEnd(10)}: ${row.n}`);
  }
  console.log();

  // Achievement predicate matches
  const pred = await reportAchievementPredicateMatches();
  console.log('  Achievement predicate matches:');
  console.log('    (cuántos stress players cumplirían cada predicate)');
  for (const row of pred) {
    console.log(`    ${row.code.padEnd(20)}: ${row.matches}`);
  }
  console.log();

  // Public wins total
  const winsCount = await reportPublicWinsCount();
  console.log(`  Public wins en DB (settled + win_amount > 0): ${winsCount}`);
  console.log();

  // Top league standings
  const leagueRep = await reportTopLeagueStandings();
  if (leagueRep.leagueName) {
    console.log(`  Top 10 standings — liga "${leagueRep.leagueName}":`);
    for (const row of leagueRep.top) {
      console.log(
        `    #${String(row.position).padStart(3)} ${row.username.padEnd(30)} score=${row.score}`,
      );
    }
  } else {
    console.log('  (sin liga activa)');
  }
  console.log();

  // HTTP endpoint validation
  console.log('  HTTP endpoint validation (5 runs warm):');
  try {
    const token = await loginAdmin();
    const endpoints = [
      ['Recent public wins', '/tenant/games/recent-wins?limit=10'],
      ['VIP tiers catalog', '/tenant/vip/tiers'],
      ['VIP me (admin)', '/tenant/vip/me'],
      ['Achievements catalog', '/tenant/achievements/definitions'],
      ['Achievements me', '/tenant/achievements/me'],
      ['Active leagues', '/tenant/leagues?status=active&limit=5'],
    ];
    const results = [];
    for (const [label, path] of endpoints) {
      results.push(await timeEndpoint(token, label, path));
    }
    for (const r of results) {
      const ok = r.status === 200;
      const color = ok ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      console.log(
        `    ${color}${r.label.padEnd(30)}${reset} status=${r.status} p50=${r.p50.toFixed(0).padStart(4)}ms p95=${r.p95.toFixed(0).padStart(4)}ms`,
      );
    }
  } catch (err) {
    console.log(`    \x1b[31mFAIL\x1b[0m: ${err.message}`);
    console.log(`    (¿está la API arriba en :3000?)`);
  }
  console.log();

  console.log('═══════════════════════════════════════════════════════');
  console.log('  DONE. Para limpiar:');
  console.log('    node scripts/engagement-stress.mjs --cleanup');
  console.log('═══════════════════════════════════════════════════════');

  await sql.end();
}

// Modo cleanup-only: borra todo y termina, sin generar nada nuevo.
// Útil para reset entre demos o antes de un perf test.
async function cleanupOnly() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ENGAGEMENT STRESS — CLEANUP ONLY');
  console.log('═══════════════════════════════════════════════════════');
  await step('Borrar stress_eng_* + deps (FK-safe)', cleanupPrevious);
  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n FROM users WHERE username LIKE 'stress_eng_%'
  `;
  console.log(`  Restantes en DB: ${n} users stress_eng_*`);
  console.log('═══════════════════════════════════════════════════════');
  await sql.end();
}

const isCleanup = process.argv.includes('--cleanup');
const entry = isCleanup ? cleanupOnly : main;

entry().catch(async (err) => {
  console.error('\n[eng] FATAL:', err.message);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
