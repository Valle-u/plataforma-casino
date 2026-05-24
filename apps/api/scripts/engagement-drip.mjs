/**
 * engagement-drip.mjs — Sprint 53.1 live mode
 *
 * Generador continuo de actividad para que el browser muestre cambios
 * EN VIVO (toasts, ticker, balance subiendo, etc.). Mientras este script
 * corre, cada N segundos inserta:
 *   - Wins de stress_eng_* players (alimentan LiveWinsTicker).
 *   - Mints/wins ocasionales para un player TARGET (env TARGET_USER) →
 *     ése player ve su balance subir + WinToastWatcher dispara toasts.
 *
 * Asume que ya corriste engagement-stress.mjs (para tener los 200
 * stress_eng_* creados).
 *
 * Uso:
 *   TARGET_USER=cliente12 node scripts/engagement-drip.mjs
 *   # o sin target:
 *   node scripts/engagement-drip.mjs
 *
 * Ctrl+C para parar.
 *
 * Tunables: INTERVAL_MS + WINS_PER_TICK + TARGET_WIN_PROBABILITY.
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
if (!TENANT_URL) throw new Error('DATABASE_URL_TENANT_TEMPLATE missing');

const sql = postgres(TENANT_URL, { max: 4 });

const TARGET_USER = process.env.TARGET_USER ?? null;
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? '6000');
const WINS_PER_TICK = Number(process.env.WINS_PER_TICK ?? '2');
const TARGET_WIN_PROBABILITY = Number(
  process.env.TARGET_WIN_PROBABILITY ?? '0.35',
);
const TARGET_WIN_MIN = Number(process.env.TARGET_WIN_MIN ?? '50');
const TARGET_WIN_MAX = Number(process.env.TARGET_WIN_MAX ?? '8000');

function uuid7() {
  return randomUUID();
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rollAmount() {
  // Mismo perfil que stress: 70% chico, 25% medio, 5% jackpot.
  const r = Math.random();
  if (r < 0.7) return randInt(80, 1500);
  if (r < 0.95) return randInt(1500, 9000);
  return randInt(15_000, 80_000);
}

let targetUserId = null;
let targetWalletId = null;
let mockGame = null;
let stressWallets = [];
let activeLeague = null;
let tickCount = 0;

async function bootstrap() {
  const games = await sql`
    SELECT id, name, category FROM games
    WHERE code LIKE 'mock_%' AND is_active = true LIMIT 1
  `;
  if (!games[0]) throw new Error('No hay mock games activos');
  mockGame = games[0];

  if (TARGET_USER) {
    const u = await sql`SELECT id FROM users WHERE username = ${TARGET_USER} LIMIT 1`;
    if (!u[0]) throw new Error(`User ${TARGET_USER} no encontrado`);
    targetUserId = u[0].id;
    const w = await sql`SELECT id FROM wallets WHERE user_id = ${targetUserId} LIMIT 1`;
    if (!w[0]) throw new Error(`User ${TARGET_USER} sin wallet`);
    targetWalletId = w[0].id;
  }

  stressWallets = await sql`
    SELECT w.id AS wallet_id, w.user_id, w.balance, u.username
    FROM wallets w JOIN users u ON u.id = w.user_id
    WHERE u.username LIKE 'stress_eng_%'
  `;
  if (stressWallets.length === 0) {
    console.log('\x1b[33m[drip] WARN: 0 stress_eng_* players. ¿Corriste engagement-stress.mjs antes?\x1b[0m');
  }

  // Liga activa (para recompute manual de standings cada N ticks).
  const leagues = await sql`
    SELECT id, name, metric, starts_at, ends_at
    FROM leagues WHERE status = 'active'
    ORDER BY starts_at DESC LIMIT 1
  `;
  activeLeague = leagues[0] ?? null;
  if (activeLeague) {
    console.log(`  Active league: "${activeLeague.name}" (metric=${activeLeague.metric})`);
  }
}

/**
 * Recompute manual de los standings de la liga activa. Replica lo que
 * hace LeaguesService.computeScores para metric=bet_volume.
 *
 * Esto evita que tengamos que esperar al cron (cada 5min) — el usuario
 * ve los puntos subir casi en vivo.
 *
 * Se llama cada RECOMPUTE_EVERY_N_TICKS ticks del drip (compromiso entre
 * "ver cambios rápido" y "no saturar la DB con upserts").
 */
async function recomputeActiveLeague() {
  if (!activeLeague) return null;
  // Soportamos solo bet_volume por ahora (la métrica del stress league).
  if (activeLeague.metric !== 'bet_volume') return null;

  const rows = await sql`
    SELECT w.user_id, COALESCE(SUM(wt.amount), 0)::numeric AS score
    FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    WHERE wt.type = 'bet'
      AND wt.created_at >= ${activeLeague.starts_at}
      AND wt.created_at < ${activeLeague.ends_at}
    GROUP BY w.user_id
    ORDER BY SUM(wt.amount) DESC
  `;

  if (rows.length === 0) return null;

  // Asignar position por orden DESC del score. PK composite (league_id,
  // user_id), no hay columna `id`; timestamp es `last_updated_at`.
  const now = new Date();
  const standings = rows.map((r, i) => ({
    league_id: activeLeague.id,
    user_id: r.user_id,
    position: i + 1,
    score: Number(r.score).toFixed(4),
    last_updated_at: now,
  }));

  await sql`
    INSERT INTO league_standings ${sql(standings)}
    ON CONFLICT (league_id, user_id) DO UPDATE SET
      position = EXCLUDED.position,
      score = EXCLUDED.score,
      last_updated_at = EXCLUDED.last_updated_at
  `;

  return standings.length;
}

/** Inserta un win simulado para un stress player random. Public wins feed lo verá en 15s. */
async function tickStressWin() {
  if (stressWallets.length === 0) return null;
  const w = pick(stressWallets);
  const bet = randInt(10, 500);
  const won = rollAmount();
  const sessionId = uuid7();
  const settledAt = new Date();

  // Session efímera (cerrada inmediatamente, evita los closing balance check del UI).
  await sql`
    INSERT INTO game_sessions ${sql({
      id: sessionId,
      user_id: w.user_id,
      game_id: mockGame.id,
      provider_session_id: `drip-${sessionId.slice(0, 8)}`,
      currency: 'CHIPS',
      status: 'closed',
      opened_balance: w.balance,
      closing_balance: w.balance,
      started_at: settledAt,
      ended_at: settledAt,
    })}
  `;

  const betTxId = uuid7();
  const winTxId = uuid7();
  const isJackpot = won >= 10_000;

  await sql`
    INSERT INTO wallet_transactions ${sql([
      {
        id: betTxId,
        wallet_id: w.wallet_id,
        type: 'bet',
        amount: bet.toFixed(2),
        balance_after: w.balance,
        idempotency_key: `drip-bet-${betTxId}`,
        reason: 'drip bet',
        source: 'engagement_drip',
        created_at: settledAt,
      },
      {
        id: winTxId,
        wallet_id: w.wallet_id,
        type: isJackpot ? 'jackpot_win' : 'win',
        amount: won.toFixed(2),
        balance_after: w.balance,
        idempotency_key: `drip-win-${winTxId}`,
        reason: 'drip win',
        related_tx_id: betTxId,
        source: 'engagement_drip',
        created_at: settledAt,
      },
    ])}
  `;

  await sql`
    INSERT INTO game_rounds ${sql({
      id: uuid7(),
      session_id: sessionId,
      user_id: w.user_id,
      game_id: mockGame.id,
      round_external_id: `drip-r-${uuid7()}`,
      bet_amount: bet.toFixed(2),
      win_amount: won.toFixed(2),
      net_amount: (won - bet).toFixed(2),
      status: 'settled',
      bet_wallet_tx_id: betTxId,
      win_wallet_tx_id: winTxId,
      payload: { source: 'drip' },
      placed_at: settledAt,
      settled_at: settledAt,
    })}
  `;

  return { username: w.username, won, isJackpot, gameName: mockGame.name };
}

/**
 * Sprint 53.1 fix: el target user ahora juega un round REAL (bet+win+round)
 * en vez de solo mint. Eso suma a su bet_volume → liga lo recomputa
 * en su próximo cron tick. Ya no es solo "balance sube" sino "engagement
 * real" que afecta a todas las métricas.
 */
async function tickTargetWin() {
  if (!targetUserId || !targetWalletId) return null;
  const won = randInt(TARGET_WIN_MIN, TARGET_WIN_MAX);
  // Bet escalado al win — para que el net siempre sea positivo (target
  // siempre "gana"), bet = won * 0.4 random. Si querés que pierda a veces,
  // poner won = 0 con prob X.
  const bet = Math.max(50, Math.floor(won * (0.3 + Math.random() * 0.3)));
  const now = new Date();

  // Read current balance.
  const w = await sql`SELECT balance, version FROM wallets WHERE id = ${targetWalletId}`;
  let balance = Number(w[0].balance);

  // Session efímera.
  const sessionId = uuid7();
  await sql`
    INSERT INTO game_sessions ${sql({
      id: sessionId,
      user_id: targetUserId,
      game_id: mockGame.id,
      provider_session_id: `drip-tgt-${sessionId.slice(0, 8)}`,
      currency: 'CHIPS',
      status: 'closed',
      opened_balance: balance.toFixed(2),
      closing_balance: balance.toFixed(2),
      started_at: now,
      ended_at: now,
    })}
  `;

  // Bet wallet_tx (debit).
  const betTxId = uuid7();
  balance -= bet;
  await sql`
    INSERT INTO wallet_transactions ${sql({
      id: betTxId,
      wallet_id: targetWalletId,
      type: 'bet',
      amount: bet.toFixed(2),
      balance_after: balance.toFixed(2),
      idempotency_key: `drip-tgt-bet-${betTxId}`,
      reason: 'drip target bet',
      source: 'engagement_drip',
      created_at: now,
    })}
  `;

  // Win wallet_tx (credit).
  const winTxId = uuid7();
  const isJackpot = won >= 10_000;
  balance += won;
  await sql`
    INSERT INTO wallet_transactions ${sql({
      id: winTxId,
      wallet_id: targetWalletId,
      type: isJackpot ? 'jackpot_win' : 'win',
      amount: won.toFixed(2),
      balance_after: balance.toFixed(2),
      idempotency_key: `drip-tgt-win-${winTxId}`,
      reason: 'drip target win',
      related_tx_id: betTxId,
      source: 'engagement_drip',
      created_at: now,
    })}
  `;

  // game_round (settled).
  await sql`
    INSERT INTO game_rounds ${sql({
      id: uuid7(),
      session_id: sessionId,
      user_id: targetUserId,
      game_id: mockGame.id,
      round_external_id: `drip-tgt-r-${uuid7()}`,
      bet_amount: bet.toFixed(2),
      win_amount: won.toFixed(2),
      net_amount: (won - bet).toFixed(2),
      status: 'settled',
      bet_wallet_tx_id: betTxId,
      win_wallet_tx_id: winTxId,
      payload: { source: 'drip_target' },
      placed_at: now,
      settled_at: now,
    })}
  `;

  // Update wallet balance.
  await sql`
    UPDATE wallets SET balance = ${balance.toFixed(2)}, version = version + 1, updated_at = NOW()
    WHERE id = ${targetWalletId}
  `;

  return { username: TARGET_USER, won, bet, newBalance: balance };
}

const RECOMPUTE_EVERY_N_TICKS = 2; // recompute liga cada N ticks

async function tick() {
  const ts = new Date().toLocaleTimeString();
  const events = [];
  for (let i = 0; i < WINS_PER_TICK; i++) {
    const ev = await tickStressWin();
    if (ev) events.push(ev);
  }
  let tgtEv = null;
  if (TARGET_USER && Math.random() < TARGET_WIN_PROBABILITY) {
    tgtEv = await tickTargetWin();
  }

  // Recompute liga cada N ticks — para que el podio actualice rápido.
  tickCount++;
  let recomputed = null;
  if (tickCount % RECOMPUTE_EVERY_N_TICKS === 0) {
    try {
      recomputed = await recomputeActiveLeague();
    } catch (err) {
      console.error(`[drip] recompute err: ${err.message}`);
    }
  }
  // Log compacto.
  const stressLine = events
    .map(
      (e) =>
        `${e.isJackpot ? '\x1b[33m💎' : '\x1b[32m✦'} ${e.username} ganó ${e.won.toLocaleString()}\x1b[0m`,
    )
    .join('  ');
  const recomputeNote = recomputed != null
    ? ` \x1b[36m[liga: ${recomputed} standings]\x1b[0m`
    : '';
  if (tgtEv) {
    console.log(
      `[${ts}] \x1b[35m★ TARGET ${tgtEv.username} bet ${tgtEv.bet} → +${tgtEv.won.toLocaleString()} chips (balance: ${Math.round(tgtEv.newBalance).toLocaleString()})\x1b[0m  ${stressLine}${recomputeNote}`,
    );
  } else if (stressLine) {
    console.log(`[${ts}] ${stressLine}${recomputeNote}`);
  } else {
    console.log(`[${ts}] (tick vacío)${recomputeNote}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ENGAGEMENT DRIP — Sprint 53.1 live mode');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Interval:    ${INTERVAL_MS}ms`);
  console.log(`  Wins/tick:   ${WINS_PER_TICK}`);
  if (TARGET_USER) {
    console.log(`  TARGET user: ${TARGET_USER} (prob ${TARGET_WIN_PROBABILITY * 100}%, win ${TARGET_WIN_MIN}-${TARGET_WIN_MAX} chips)`);
  } else {
    console.log(`  (sin TARGET_USER — solo alimenta el ticker de wins)`);
  }
  console.log();
  console.log('  Ctrl+C para parar.');
  console.log();

  await bootstrap();
  console.log(`  Game: ${mockGame.name}, stress wallets: ${stressWallets.length}`);
  if (TARGET_USER) console.log(`  Target wallet ID: ${targetWalletId}`);
  console.log();

  // Loop principal — fire-and-forget cada INTERVAL_MS.
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error(`[drip] err: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

process.on('SIGINT', async () => {
  console.log('\n[drip] stopping…');
  await sql.end().catch(() => undefined);
  process.exit(0);
});

main().catch(async (err) => {
  console.error('\n[drip] FATAL:', err.message);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
