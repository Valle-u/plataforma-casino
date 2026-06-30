/**
 * E2E: motor de comisiones por red — C2 (NetWin), modelo SOCIOS-ONLY.
 * docs/16-tesoreria.md §11.
 *
 * La plataforma SOLO le paga al socio: su % × NetWin de TODA su red. Lo que el
 * socio reparte hacia abajo (distribuidores/cajeros) es asunto del socio, por
 * fuera de la plataforma — no se computa ni se liquida acá.
 *
 * Verifica `POST /tenant/commissions/network/compute`:
 *   1. El socio cobra su % sobre la NetWin de toda su red; los niveles de abajo
 *      NO reciben fila (aunque tengan % cargado).
 *   2. Solo cuentan rounds status='settled' (placed y rolled_back excluidos).
 *   3. Ramas independientes excluidas.
 *   4. Carryover encadenado (negativo → payable 0 + arrastre; se recupera).
 *   5. Idempotencia + limpieza de filas stale al recomputar.
 *   6. Un operador (cajero/distribuidor) que juega NO infla la NetWin del socio.
 *
 * Los game_rounds se insertan DIRECTO en DB para controlar bet/win/status/
 * settled_at con precisión.
 */

import { sql } from 'drizzle-orm';
import { loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

const P = (ym: string): Date => new Date(`${ym}-01T00:00:00.000Z`);

describe('Commissions network engine (C2 socios-only, E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;
  let gameSession: { gameId: string; sessionId: string } | null = null;
  let roundSeq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    const aRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username} LIMIT 1`,
    );
    adminId = (aRow as unknown as Array<{ id: string }>)[0]!.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  async function ensureGameSession(): Promise<{ gameId: string; sessionId: string }> {
    if (gameSession) return gameSession;
    await ctx.tenantDb.execute(
      sql`INSERT INTO games (id, code, name, category)
          VALUES (gen_random_uuid(), 'netwin_test_game', 'NetWin Test', 'slots')
          ON CONFLICT (code) DO NOTHING`,
    );
    const g = await ctx.tenantDb.execute(
      sql`SELECT id FROM games WHERE code = 'netwin_test_game' LIMIT 1`,
    );
    const gameId = (g as unknown as Array<{ id: string }>)[0]!.id;
    const s = await ctx.tenantDb.execute(
      sql`INSERT INTO game_sessions (id, user_id, game_id, provider_session_id)
          VALUES (gen_random_uuid(), ${adminId}, ${gameId}, 'netwin-test-sess')
          RETURNING id`,
    );
    const sessionId = (s as unknown as Array<{ id: string }>)[0]!.id;
    gameSession = { gameId, sessionId };
    return gameSession;
  }

  async function insertRound(
    userId: string,
    bet: number,
    win: number,
    status: 'settled' | 'placed' | 'rolled_back',
    when: Date,
  ): Promise<void> {
    const { gameId, sessionId } = await ensureGameSession();
    const net = (win - bet).toFixed(2);
    const ext = `nw-${roundSeq++}`;
    const whenIso = when.toISOString();
    const settledAt = status === 'settled' ? whenIso : null;
    await ctx.tenantDb.execute(
      sql`INSERT INTO game_rounds
            (id, session_id, user_id, game_id, round_external_id,
             bet_amount, win_amount, net_amount, status, placed_at, settled_at)
          VALUES
            (gen_random_uuid(), ${sessionId}, ${userId}, ${gameId}, ${ext},
             ${bet.toFixed(2)}, ${win.toFixed(2)}, ${net}, ${status}, ${whenIso}, ${settledAt})`,
    );
  }

  async function setRate(userId: string, rate: number): Promise<void> {
    await ctx.tenantDb.execute(
      sql`UPDATE users SET commission_rate = ${rate.toFixed(2)} WHERE id = ${userId}`,
    );
  }

  async function setParent(childId: string, parentId: string, rel: string): Promise<void> {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType: rel });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`setParent falló: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function compute(period: string): Promise<{
    sociosComputed: number;
    totalPayable: string;
    totalGross: string;
    totalNetWin: string;
    baseConsistency: { ok: boolean; sumSocioSubNetWin: string; sumPlayersUnderSocio: string };
  }> {
    const res = await ctx.request
      .post('/tenant/commissions/network/compute')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ period });
    if (res.status !== 200) {
      throw new Error(`compute falló: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async function getRow(
    operatorId: string,
    periodStart: Date,
  ): Promise<{
    sub_net_win: string;
    gross_commission: string;
    carryover_in: string;
    carryover_out: string;
    payable: string;
    status: string;
  } | null> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT sub_net_win, gross_commission, carryover_in, carryover_out, payable, status
          FROM commission_network_periods
          WHERE operator_user_id = ${operatorId} AND period_start = ${periodStart.toISOString()}
          LIMIT 1`,
    );
    return (
      (r as unknown as Array<{
        sub_net_win: string;
        gross_commission: string;
        carryover_in: string;
        carryover_out: string;
        payable: string;
        status: string;
      }>)[0] ?? null
    );
  }

  async function mkUser(label: string, role: string) {
    return createTestUser(ctx.request, adminToken, { suite: 'comm-net-engine', label, role });
  }

  // ── Tests ────────────────────────────────────────────────────────────

  it('el socio cobra su % sobre TODA su red; los de abajo no reciben fila', async () => {
    const period = '2025-08';
    const socio = await mkUser('t1_socio', 'socio');
    const distrib = await mkUser('t1_distrib', 'distribuidor');
    const cajero = await mkUser('t1_cajero', 'cajero');
    const p1 = await mkUser('t1_p1', 'usuario_final');
    const p2 = await mkUser('t1_p2', 'usuario_final');
    await setParent(distrib.id, socio.id, 'distribuidor_de_socio');
    await setParent(cajero.id, distrib.id, 'cajero_de_distribuidor');
    await setParent(p1.id, cajero.id, 'jugador_de_cajero');
    await setParent(p2.id, cajero.id, 'jugador_de_cajero');

    // Solo el % del socio importa; los de abajo se cargan pero la plataforma los IGNORA.
    await setRate(socio.id, 10);
    await setRate(distrib.id, 6);
    await setRate(cajero.id, 4);

    // NetWin red = p1 (1000−600=+400) + p2 (500−700=−200) = 200.
    await insertRound(p1.id, 1000, 600, 'settled', P(period));
    await insertRound(p2.id, 500, 700, 'settled', P(period));

    const res = await compute(period);

    // El socio cobra 10% de los 200 de TODA su red = 20 (monto completo, no el spread).
    const rs = (await getRow(socio.id, P(period)))!;
    expect(Number(rs.sub_net_win)).toBeCloseTo(200, 2);
    expect(Number(rs.gross_commission)).toBeCloseTo(20, 2);
    expect(Number(rs.payable)).toBeCloseTo(20, 2);

    // Distribuidor y cajero NO reciben fila (la plataforma solo paga socios).
    expect(await getRow(distrib.id, P(period))).toBeNull();
    expect(await getRow(cajero.id, P(period))).toBeNull();

    expect(res.sociosComputed).toBe(1);
    expect(res.baseConsistency.ok).toBe(true);

    // Endpoint de lectura: el admin ve la fila del socio.
    const list = await ctx.request
      .get(`/tenant/commissions/network/periods?period=${period}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(list.status).toBe(200);
    const ids = (list.body.periods as Array<{ operatorUserId: string }>).map((p) => p.operatorUserId);
    expect(ids).toContain(socio.id);
    expect(ids).not.toContain(distrib.id);
  });

  it('solo cuentan rounds settled (placed y rolled_back excluidos)', async () => {
    const period = '2025-09';
    const socio = await mkUser('t2_socio', 'socio');
    const player = await mkUser('t2_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 10);

    await insertRound(player.id, 1000, 0, 'settled', P(period)); // +1000
    await insertRound(player.id, 5000, 0, 'placed', P(period)); // NO
    await insertRound(player.id, 3000, 0, 'rolled_back', P(period)); // NO

    await compute(period);
    const rs = (await getRow(socio.id, P(period)))!;
    expect(Number(rs.sub_net_win)).toBeCloseTo(1000, 2);
    expect(Number(rs.gross_commission)).toBeCloseTo(100, 2); // 10%·1000
  });

  it('ramas independientes excluidas (no generan comisión ni NetWin)', async () => {
    const period = '2025-10';
    const socioN = await mkUser('t3_socioN', 'socio');
    const playerN = await mkUser('t3_playerN', 'usuario_final');
    await setParent(playerN.id, socioN.id, 'jugador_de_socio');
    await setRate(socioN.id, 10);
    await insertRound(playerN.id, 800, 500, 'settled', P(period)); // NetWin 300

    const socioI = await mkUser('t3_socioI', 'socio');
    const playerI = await mkUser('t3_playerI', 'usuario_final');
    await setParent(playerI.id, socioI.id, 'jugador_de_socio');
    await setRate(socioI.id, 10);
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${socioI.id}`,
    );
    await insertRound(playerI.id, 1000, 500, 'settled', P(period)); // 500 (excluido)

    const res = await compute(period);
    expect(await getRow(socioI.id, P(period))).toBeNull();
    const rn = (await getRow(socioN.id, P(period)))!;
    expect(Number(rn.gross_commission)).toBeCloseTo(30, 2); // 10%·300
    expect(Number(res.totalNetWin)).toBeCloseTo(300, 2);
    expect(res.baseConsistency.ok).toBe(true);
  });

  it('carryover: período negativo se arrastra y se recupera', async () => {
    const prev = '2025-06';
    const next = '2025-07';
    const socio = await mkUser('t4_socio', 'socio');
    const player = await mkUser('t4_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 5);

    await insertRound(player.id, 1000, 2000, 'settled', P(prev)); // NetWin −1000
    await compute(prev);
    const r1 = (await getRow(socio.id, P(prev)))!;
    expect(Number(r1.gross_commission)).toBeCloseTo(-50, 2);
    expect(Number(r1.payable)).toBeCloseTo(0, 2);
    expect(Number(r1.carryover_out)).toBeCloseTo(-50, 2);

    await insertRound(player.id, 3000, 0, 'settled', P(next)); // NetWin +3000
    await compute(next);
    const r2 = (await getRow(socio.id, P(next)))!;
    expect(Number(r2.gross_commission)).toBeCloseTo(150, 2);
    expect(Number(r2.carryover_in)).toBeCloseTo(-50, 2);
    expect(Number(r2.payable)).toBeCloseTo(100, 2);
    expect(Number(r2.carryover_out)).toBeCloseTo(0, 2);
  });

  it('idempotencia + limpieza de filas stale al recomputar', async () => {
    const period = '2025-05';
    const socio = await mkUser('t5_socio', 'socio');
    const player = await mkUser('t5_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 5);
    await insertRound(player.id, 1000, 0, 'settled', P(period)); // NetWin 1000

    await compute(period);
    const before = (await getRow(socio.id, P(period)))!;
    expect(Number(before.gross_commission)).toBeCloseTo(50, 2);

    // Recompute idéntico: una sola fila, mismo monto.
    await compute(period);
    const cnt = await ctx.tenantDb.execute(
      sql`SELECT COUNT(*)::int AS n FROM commission_network_periods
          WHERE operator_user_id = ${socio.id} AND period_start = ${P(period).toISOString()}`,
    );
    expect((cnt as unknown as Array<{ n: number }>)[0]!.n).toBe(1);

    // El round se anula → el socio deja de generar → la fila vieja NO queda stale.
    await ctx.tenantDb.execute(
      sql`UPDATE game_rounds SET status = 'rolled_back', rolled_back_at = now()
          WHERE user_id = ${player.id} AND status = 'settled'`,
    );
    await compute(period);
    expect(await getRow(socio.id, P(period))).toBeNull();
  });

  it('un operador que juega no infla la NetWin del socio', async () => {
    const period = '2025-04';
    const socio = await mkUser('t6_socio', 'socio');
    const cajero = await mkUser('t6_cajero', 'cajero');
    const player = await mkUser('t6_player', 'usuario_final');
    await setParent(cajero.id, socio.id, 'cajero_de_socio');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(socio.id, 10);
    await insertRound(player.id, 200, 0, 'settled', P(period)); // jugador: NetWin 200
    await insertRound(cajero.id, 1000, 0, 'settled', P(period)); // el cajero JUEGA: 1000

    await compute(period);
    const rs = (await getRow(socio.id, P(period)))!;
    // subNetWin = 200 (solo el jugador), NO 1200. gross = 10%·200 = 20.
    expect(Number(rs.sub_net_win)).toBeCloseTo(200, 2);
    expect(Number(rs.gross_commission)).toBeCloseTo(20, 2);
  });
});
