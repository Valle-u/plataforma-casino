/**
 * simulate-operation — puebla el tenant demo con una operativa multinivel
 * realista y verifica que el motor de comisiones por red da bien.
 *
 * Escenario (mes en curso):
 *   - La Casa recibe capital (mint).
 *   - Jerarquía: admin → socios → distribuidores → cajeros → jugadores.
 *   - Casa → cajeros → jugadores: carga de fichas (transfers).
 *   - Jugadores apuestan (game_rounds settled + efecto bet/win en wallets,
 *     con la Casa de contraparte).
 *   - Se computa el mes con el MOTOR REAL (NetworkCommissionsService).
 *   - Reporte: comisión computada vs esperada (cruce a mano), por socio.
 *
 * Uso (tsx vive en @casino/db; conviene resetear el demo antes):
 *   pnpm --filter @casino/db db:reset:demo
 *   cd packages/db && pnpm exec tsx ../../apps/api/src/scripts/simulate-operation.ts
 *
 * Deja el demo poblado (visible en el panel) + imprime el cruce comisión
 * computada vs esperada por socio.
 */
import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { hashPassword } from '@casino/db';
import { NetworkCommissionsService } from '../commissions/network-commissions.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';

// apps/api/.env.local — relativo al script (src/scripts), no al cwd.
loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env.local'),
});

const CREDIT = new Set([
  'mint', 'load', 'transfer_in', 'win', 'deposit', 'bonus_grant', 'bonus_clear',
  'bonus_funding_revert', 'jackpot_win', 'promo_reward', 'league_reward',
  'commission_payout', 'fund_release',
]);
const DEBIT = new Set([
  'burn', 'unload', 'transfer_out', 'bet', 'withdrawal', 'bonus_forfeit',
  'bonus_funding', 'fund_reserve',
]);

// ── Escenario ──────────────────────────────────────────────────────────
interface PlayerSpec { label: string; rounds: Array<{ bet: number; win: number }> }
interface CajeroSpec { label: string; players: PlayerSpec[] }
interface DistSpec { label: string; cajeros: CajeroSpec[] }
interface SocioSpec { label: string; rate: number; independent?: boolean; dists?: DistSpec[]; cajeros?: CajeroSpec[] }

const SCENARIO: SocioSpec[] = [
  {
    label: 'socioA', rate: 10,
    dists: [
      { label: 'distA1', cajeros: [
        { label: 'cajeroA1', players: [
          { label: 'pA1', rounds: [{ bet: 6000, win: 2000 }, { bet: 6000, win: 5000 }] }, // NetWin +5000
          { label: 'pA2', rounds: [{ bet: 4000, win: 5000 }, { bet: 4000, win: 4500 }] }, // -1500
        ] },
        { label: 'cajeroA2', players: [
          { label: 'pA3', rounds: [{ bet: 8000, win: 6000 }, { bet: 7000, win: 4000 }] }, // +5000
        ] },
      ] },
      { label: 'distA2', cajeros: [
        { label: 'cajeroA3', players: [
          { label: 'pA4', rounds: [{ bet: 6000, win: 4000 }] }, // +2000
        ] },
      ] },
    ],
  }, // socioA network NetWin = 5000 - 1500 + 5000 + 2000 = 10500 → 10% = 1050
  {
    label: 'socioB', rate: 6,
    dists: [
      { label: 'distB1', cajeros: [
        { label: 'cajeroB1', players: [
          { label: 'pB1', rounds: [{ bet: 5000, win: 2000 }, { bet: 4000, win: 3000 }] }, // +4000
          { label: 'pB2', rounds: [{ bet: 7000, win: 8000 }] }, // -1000
        ] },
      ] },
    ],
  }, // socioB network NetWin = 4000 - 1000 = 3000 → 6% = 180
  {
    label: 'socioC', rate: 8, independent: true,
    cajeros: [
      { label: 'cajeroC1', players: [
        { label: 'pC1', rounds: [{ bet: 10000, win: 6000 }] }, // +4000 (EXCLUIDO)
      ] },
    ],
  },
];

const CASA_CAPITAL = 10_000_000;
const SOCIO_CAPITAL = 1_000_000;
const CAJERO_CAPITAL = 200_000;
const LOAD_PER_PLAYER = 40_000;

async function main(): Promise<void> {
  const template = process.env.DATABASE_URL_TENANT_TEMPLATE!;
  const url = template.replace('<tenant_db>', 'tenant_demo_casino');
  const client = postgres(url, { max: 1 });
  const db = drizzle(client) as unknown as TenantDb;

  const walletId = new Map<string, string>();
  const balance = new Map<string, number>();
  let txSeq = 0;
  const pwHash = await hashPassword('sim-pwd-2026');

  // role ids + casa/admin
  const roleRows = await client<{ id: string; code: string }[]>`SELECT id, code FROM roles`;
  const roleId = new Map(roleRows.map((r) => [r.code, r.id]));
  const [{ id: casaId }] = await client<{ id: string }[]>`SELECT id FROM users WHERE username='__casa__' LIMIT 1`;
  const [{ id: adminId }] = await client<{ id: string }[]>`SELECT id FROM users WHERE username='demo_admin' LIMIT 1`;

  async function ensureWallet(userId: string): Promise<void> {
    const rows = await client<{ id: string }[]>`SELECT id FROM wallets WHERE user_id=${userId} LIMIT 1`;
    if (rows[0]) { walletId.set(userId, rows[0].id); return; }
    const ins = await client<{ id: string }[]>`INSERT INTO wallets (id, user_id, balance) VALUES (gen_random_uuid(), ${userId}, '0') RETURNING id`;
    walletId.set(userId, ins[0]!.id);
    balance.set(userId, 0);
  }

  async function applyTx(userId: string, type: string, amount: number, reason?: string): Promise<void> {
    const cur = balance.get(userId) ?? 0;
    const next = CREDIT.has(type) ? cur + amount : cur - amount;
    if (next < 0) throw new Error(`Balance negativo: ${userId} ${type} ${amount} (cur=${cur})`);
    balance.set(userId, next);
    await client`
      INSERT INTO wallet_transactions (id, wallet_id, type, amount, balance_after, source, reason, idempotency_key)
      VALUES (gen_random_uuid(), ${walletId.get(userId)!}, ${type}::wallet_tx_type, ${amount.toFixed(2)}, ${next.toFixed(2)}, 'simulation', ${reason ?? null}, ${'sim:' + txSeq++})`;
  }
  async function transfer(from: string, to: string, amount: number): Promise<void> {
    await applyTx(from, 'transfer_out', amount);
    await applyTx(to, 'transfer_in', amount);
  }

  async function createUser(username: string, role: string, parentUserId: string | null, commissionRate?: number): Promise<string> {
    const ins = await client<{ id: string }[]>`
      INSERT INTO users (id, username, password_hash, display_name, status, is_independent_branch, commission_rate)
      VALUES (gen_random_uuid(), ${username}, ${pwHash}, ${username}, 'active', false, ${(commissionRate ?? 0).toFixed(2)})
      RETURNING id`;
    const id = ins[0]!.id;
    await client`INSERT INTO user_roles (user_id, role_id) VALUES (${id}, ${roleId.get(role)!})`;
    if (parentUserId) {
      await client`INSERT INTO user_hierarchy (id, user_id, parent_user_id, relation_type) VALUES (gen_random_uuid(), ${id}, ${parentUserId}, 'sim')`;
    }
    await ensureWallet(id);
    return id;
  }

  // 1. Casa capital.
  await ensureWallet(casaId);
  await applyTx(casaId, 'mint', CASA_CAPITAL, 'capital inicial (simulación)');

  // 2-4. Jerarquía + carga + apuestas.
  await client`INSERT INTO games (id, code, name, category) VALUES (gen_random_uuid(), 'sim_slots', 'Sim Slots', 'slots') ON CONFLICT (code) DO NOTHING`;
  const [{ id: gameId }] = await client<{ id: string }[]>`SELECT id FROM games WHERE code='sim_slots' LIMIT 1`;
  const now = new Date();
  let roundSeq = 0;

  async function setupPlayer(p: PlayerSpec, cajeroId: string): Promise<{ netWin: number }> {
    const id = await createUser(p.label, 'usuario_final', cajeroId);
    await transfer(cajeroId, id, LOAD_PER_PLAYER); // cajero le carga fichas
    // sesión + rounds
    const ses = await client<{ id: string }[]>`INSERT INTO game_sessions (id, user_id, game_id, provider_session_id) VALUES (gen_random_uuid(), ${id}, ${gameId}, ${'sim-' + p.label}) RETURNING id`;
    const sessionId = ses[0]!.id;
    let sumBet = 0, sumWin = 0;
    for (const r of p.rounds) {
      sumBet += r.bet; sumWin += r.win;
      await client`
        INSERT INTO game_rounds (id, session_id, user_id, game_id, round_external_id, bet_amount, win_amount, net_amount, status, placed_at, settled_at)
        VALUES (gen_random_uuid(), ${sessionId}, ${id}, ${gameId}, ${'r-' + roundSeq++}, ${r.bet.toFixed(2)}, ${r.win.toFixed(2)}, ${(r.win - r.bet).toFixed(2)}, 'settled', ${now.toISOString()}, ${now.toISOString()})`;
    }
    // efecto en wallets: bet (player→Casa), win (Casa→player).
    if (sumBet > 0) { await applyTx(id, 'bet', sumBet); await applyTx(casaId, 'transfer_in', sumBet); }
    if (sumWin > 0) { await applyTx(casaId, 'transfer_out', sumWin); await applyTx(id, 'win', sumWin); }
    return { netWin: sumBet - sumWin };
  }

  const expected: Array<{ socio: string; rate: number; networkNetWin: number; commission: number; independent: boolean }> = [];

  for (const s of SCENARIO) {
    const socioId = await createUser(s.label, 'socio', adminId, s.rate);
    if (s.independent) {
      await client`UPDATE users SET is_independent_branch=true WHERE id=${socioId}`;
    }
    await transfer(casaId, socioId, SOCIO_CAPITAL); // capital de trabajo del socio
    let networkNetWin = 0;
    const cajerosUnder = async (cajeros: CajeroSpec[], parentId: string) => {
      for (const c of cajeros) {
        const cajeroId = await createUser(c.label, 'cajero', parentId);
        await transfer(socioId, cajeroId, CAJERO_CAPITAL); // el socio fondea al cajero
        for (const p of c.players) {
          const { netWin } = await setupPlayer(p, cajeroId);
          networkNetWin += netWin;
        }
      }
    };
    if (s.dists) {
      for (const d of s.dists) {
        const distId = await createUser(d.label, 'distribuidor', socioId);
        await cajerosUnder(d.cajeros, distId);
      }
    }
    if (s.cajeros) await cajerosUnder(s.cajeros, socioId);

    expected.push({
      socio: s.label, rate: s.rate, networkNetWin,
      commission: s.independent ? 0 : Math.round((s.rate * networkNetWin) / 100 * 100) / 100,
      independent: !!s.independent,
    });
  }

  // Persistir balances finales.
  for (const [userId, bal] of balance) {
    await client`UPDATE wallets SET balance=${bal.toFixed(2)}, updated_at=now() WHERE user_id=${userId}`;
  }

  // 5. COMPUTE con el motor real (mes en curso).
  const period = NetworkCommissionsService.monthBoundsContaining(now);
  const svc = new NetworkCommissionsService(undefined as never, undefined as never);
  const result = await svc.computePeriod(db, period);

  // 6. Reporte + cruce.
  const rows = await client<{ username: string; sub_net_win: string; gross_commission: string; payable: string; rate_snapshot: string; status: string }[]>`
    SELECT u.username, p.sub_net_win, p.gross_commission, p.payable, p.rate_snapshot, p.status
    FROM commission_network_periods p JOIN users u ON u.id=p.operator_user_id
    WHERE p.period_start=${period.periodStart.toISOString()} ORDER BY u.username`;
  const byUser = new Map(rows.map((r) => [r.username, r]));

  console.log('\n========== SIMULACIÓN: COMISIONES POR RED ==========');
  console.log(`Período: ${period.periodStart.toISOString().slice(0, 7)} (mes en curso)`);
  console.log(`Resultado motor: socios=${result.sociosComputed} totalNetWin=${result.totalNetWin} totalPayable=${result.totalPayable} baseConsistency.ok=${result.baseConsistency.ok}\n`);

  let allOk = true;
  for (const e of expected) {
    const row = byUser.get(e.socio);
    if (e.independent) {
      const ok = !row;
      allOk &&= ok;
      console.log(`  ${e.socio} (INDEPENDIENTE, ${e.rate}%): red NetWin=${e.networkNetWin} → SIN comisión. Motor: ${row ? '✗ generó fila!' : 'sin fila ✓'}`);
      continue;
    }
    const computedGross = row ? Number(row.gross_commission) : 0;
    const computedSub = row ? Number(row.sub_net_win) : 0;
    const ok = row != null && Math.abs(computedGross - e.commission) < 0.01 && Math.abs(computedSub - e.networkNetWin) < 0.01;
    allOk &&= ok;
    console.log(`  ${e.socio} (${e.rate}%): red NetWin esperado=${e.networkNetWin} computado=${computedSub} | comisión esperada=${e.commission} computada=${computedGross} | ${ok ? '✓' : '✗ DESCUADRE'}`);
  }
  console.log(`\n========== ${allOk ? 'TODO CUADRA ✓' : 'HAY DESCUADRES ✗'} ==========\n`);

  await client.end();
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('SIMULACIÓN FALLÓ:', err);
  process.exit(1);
});
