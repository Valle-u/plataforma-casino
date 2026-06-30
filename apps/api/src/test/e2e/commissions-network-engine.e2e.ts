/**
 * E2E: motor de comisiones por red — C2 (NetWin).
 * docs/16-tesoreria.md §11.
 *
 * Verifica `POST /tenant/commissions/network/compute` y el cómputo:
 *   1. Cascada multinivel (socio→distrib→cajero→jugadores) + invariante de
 *      conservación (Σ gross == R_socio·subNetWin) + endpoint de lectura.
 *   2. Solo cuentan rounds status='settled' (placed y rolled_back excluidos).
 *   3. Ramas independientes excluidas (no generan comisión ni entran a NetWin).
 *   4. Carryover encadenado: período negativo → payable 0 + carryoverOut<0;
 *      el siguiente lo recupera antes de pagar.
 *   5. Idempotencia: recomputar el mismo período no duplica ni cambia montos.
 *   6. Markup bidireccional: el padre no puede bajar su % por debajo de un hijo.
 *
 * Los game_rounds se insertan DIRECTO en DB para controlar bet/win/status/
 * settled_at con precisión (el flujo real de juego no permite fijar el win).
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

const P = (ym: string): Date => new Date(`${ym}-01T00:00:00.000Z`);

describe('Commissions network engine (C2, E2E)', () => {
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

  /** Inserta un game_round con bet/win/status/fecha controlados. */
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

  async function setParent(
    childId: string,
    parentId: string,
    rel: string,
  ): Promise<void> {
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
    operatorsComputed: number;
    totalPayable: string;
    totalGross: string;
    totalNetWin: string;
    conservation: { diff: string; ok: boolean };
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
    return createTestUser(ctx.request, adminToken, {
      suite: 'comm-net-engine',
      label,
      role,
    });
  }

  // ── Tests ────────────────────────────────────────────────────────────

  it('cascada multinivel: gross por nivel + conservación', async () => {
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

    // Markup sano: socio 10% ≥ distrib 6% ≥ cajero 4%.
    await setRate(socio.id, 10);
    await setRate(distrib.id, 6);
    await setRate(cajero.id, 4);

    // NetWin: p1 = 1000−600 = +400 ; p2 = 500−700 = −200 → subNetWin = 200.
    await insertRound(p1.id, 1000, 600, 'settled', P(period));
    await insertRound(p2.id, 500, 700, 'settled', P(period));

    const res = await compute(period);

    // gross(cajero)=4%·200=8 ; gross(distrib)=(6−4)%·200=4 ; gross(socio)=(10−6)%·200=8.
    const rc = (await getRow(cajero.id, P(period)))!;
    const rd = (await getRow(distrib.id, P(period)))!;
    const rs = (await getRow(socio.id, P(period)))!;

    expect(Number(rc.sub_net_win)).toBeCloseTo(200, 2);
    expect(Number(rc.gross_commission)).toBeCloseTo(8, 2);
    expect(Number(rc.payable)).toBeCloseTo(8, 2);

    expect(Number(rd.sub_net_win)).toBeCloseTo(200, 2);
    expect(Number(rd.gross_commission)).toBeCloseTo(4, 2);

    expect(Number(rs.sub_net_win)).toBeCloseTo(200, 2);
    expect(Number(rs.gross_commission)).toBeCloseTo(8, 2);

    // Conservación: Σ gross (8+4+8=20) == R_socio·subNetWin (10%·200=20).
    expect(res.conservation.ok).toBe(true);
    expect(Number(res.conservation.diff)).toBeCloseTo(0, 2);

    // Endpoint de lectura (admin ve todo).
    const list = await ctx.request
      .get(`/tenant/commissions/network/periods?period=${period}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(list.status).toBe(200);
    const ids = (list.body.periods as Array<{ operatorUserId: string }>).map(
      (p) => p.operatorUserId,
    );
    expect(ids).toEqual(
      expect.arrayContaining([socio.id, distrib.id, cajero.id]),
    );
  });

  it('solo cuentan rounds settled (placed y rolled_back excluidos)', async () => {
    const period = '2025-09';
    const cajero = await mkUser('t2_cajero', 'cajero');
    const player = await mkUser('t2_player', 'usuario_final');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(cajero.id, 5);

    await insertRound(player.id, 1000, 0, 'settled', P(period)); // cuenta: +1000
    await insertRound(player.id, 5000, 0, 'placed', P(period)); // NO cuenta
    await insertRound(player.id, 3000, 0, 'rolled_back', P(period)); // NO cuenta

    await compute(period);
    const rc = (await getRow(cajero.id, P(period)))!;

    // subNetWin = 1000 (solo el settled), no 9000.
    expect(Number(rc.sub_net_win)).toBeCloseTo(1000, 2);
    expect(Number(rc.gross_commission)).toBeCloseTo(50, 2); // 5%·1000
  });

  it('ramas independientes excluidas (no generan comisión ni NetWin)', async () => {
    const period = '2025-10';
    // Normal: socioN con cajero + jugador (NetWin 300).
    const socioN = await mkUser('t3_socioN', 'socio');
    const cajeroN = await mkUser('t3_cajeroN', 'cajero');
    const playerN = await mkUser('t3_playerN', 'usuario_final');
    await setParent(cajeroN.id, socioN.id, 'cajero_de_socio');
    await setParent(playerN.id, cajeroN.id, 'jugador_de_cajero');
    await setRate(socioN.id, 10);
    await setRate(cajeroN.id, 5);
    await insertRound(playerN.id, 800, 500, 'settled', P(period)); // NetWin 300

    // Independiente: socioI (is_independent_branch) con jugador (NetWin 500).
    const socioI = await mkUser('t3_socioI', 'socio');
    const playerI = await mkUser('t3_playerI', 'usuario_final');
    await setParent(playerI.id, socioI.id, 'jugador_de_socio');
    await setRate(socioI.id, 10);
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${socioI.id}`,
    );
    await insertRound(playerI.id, 1000, 500, 'settled', P(period)); // NetWin 500 (excluido)

    const res = await compute(period);

    // El socio independiente NO tiene fila.
    expect(await getRow(socioI.id, P(period))).toBeNull();
    // El socio normal sí, con su NetWin propio (300, sin el 500 del independiente).
    const rn = (await getRow(socioN.id, P(period)))!;
    expect(Number(rn.sub_net_win)).toBeCloseTo(300, 2);
    // gross = spread sobre su cajero (rate 5): (10−5)%·300 = 15.
    expect(Number(rn.gross_commission)).toBeCloseTo(15, 2);
    const rcn = (await getRow(cajeroN.id, P(period)))!;
    expect(Number(rcn.gross_commission)).toBeCloseTo(15, 2); // 5%·300
    // totalNetWin del período excluye al independiente (solo 300).
    expect(Number(res.totalNetWin)).toBeCloseTo(300, 2);
    expect(res.conservation.ok).toBe(true);
  });

  it('carryover encadenado: período negativo se arrastra y se recupera', async () => {
    const prev = '2025-06';
    const next = '2025-07';
    const cajero = await mkUser('t4_cajero', 'cajero');
    const player = await mkUser('t4_player', 'usuario_final');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(cajero.id, 5);

    // Período 1: NetWin −1000 (bet 1000, win 2000) → gross −50 → payable 0, carryOut −50.
    await insertRound(player.id, 1000, 2000, 'settled', P(prev));
    await compute(prev);
    const r1 = (await getRow(cajero.id, P(prev)))!;
    expect(Number(r1.gross_commission)).toBeCloseTo(-50, 2);
    expect(Number(r1.payable)).toBeCloseTo(0, 2);
    expect(Number(r1.carryover_out)).toBeCloseTo(-50, 2);

    // Período 2: NetWin +3000 → gross +150 ; carryIn −50 → newBal 100 → payable 100, carryOut 0.
    await insertRound(player.id, 3000, 0, 'settled', P(next));
    await compute(next);
    const r2 = (await getRow(cajero.id, P(next)))!;
    expect(Number(r2.gross_commission)).toBeCloseTo(150, 2);
    expect(Number(r2.carryover_in)).toBeCloseTo(-50, 2);
    expect(Number(r2.payable)).toBeCloseTo(100, 2);
    expect(Number(r2.carryover_out)).toBeCloseTo(0, 2);
  });

  it('idempotencia: recomputar no duplica ni cambia montos', async () => {
    const period = '2025-11';
    const cajero = await mkUser('t5_cajero', 'cajero');
    const player = await mkUser('t5_player', 'usuario_final');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(cajero.id, 5);
    await insertRound(player.id, 2000, 0, 'settled', P(period)); // NetWin 2000 → gross 100

    await compute(period);
    const first = (await getRow(cajero.id, P(period)))!;
    expect(Number(first.gross_commission)).toBeCloseTo(100, 2);

    // Recompute: mismos montos, una sola fila.
    await compute(period);
    const second = (await getRow(cajero.id, P(period)))!;
    expect(Number(second.gross_commission)).toBeCloseTo(100, 2);

    const cnt = await ctx.tenantDb.execute(
      sql`SELECT COUNT(*)::int AS n FROM commission_network_periods
          WHERE operator_user_id = ${cajero.id} AND period_start = ${P(period).toISOString()}`,
    );
    expect((cnt as unknown as Array<{ n: number }>)[0]!.n).toBe(1);
  });

  it('markup bidireccional: el padre no puede bajar su % por debajo de un hijo', async () => {
    const socio = await mkUser('t6_socio', 'socio');
    const distrib = await mkUser('t6_distrib', 'distribuidor');
    const cajero = await mkUser('t6_cajero', 'cajero');
    await setParent(distrib.id, socio.id, 'distribuidor_de_socio');
    await setParent(cajero.id, distrib.id, 'cajero_de_distribuidor');

    // Admin fija socio=10 ; socio fija distrib=8 ; distrib fija cajero=6.
    const socioToken = await loginAs(ctx.request, socio.username, socio.password);
    const distribToken = await loginAs(
      ctx.request,
      distrib.username,
      distrib.password,
    );

    const setRateApi = (token: string, childId: string, rate: number) =>
      ctx.request
        .patch(`/tenant/commissions/network-rate/${childId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token)
        .send({ rate });

    expect((await setRateApi(adminToken, socio.id, 10)).status).toBe(200);
    expect((await setRateApi(socioToken, distrib.id, 8)).status).toBe(200);
    expect((await setRateApi(distribToken, cajero.id, 6)).status).toBe(200);

    // El socio intenta BAJAR distrib a 5 (< el 6 del cajero) → 409 RATE_BELOW_CHILDREN.
    const bad = await setRateApi(socioToken, distrib.id, 5);
    expect(bad.status).toBe(409);
    expect(bad.body.error).toBe('RATE_BELOW_CHILDREN');

    // Bajarlo a 6 (== el del cajero) sí se permite.
    expect((await setRateApi(socioToken, distrib.id, 6)).status).toBe(200);
  });

  it('cascada con nodo NO-operador intermedio: el ancestro descuenta al nieto operador', async () => {
    // socio(10) → empleado (NO operador) → cajero(4) → jugador (NetWin 100).
    const period = '2025-03';
    const socio = await mkUser('t7_socio', 'socio');
    const empleado = await mkUser('t7_empleado', 'empleado');
    const cajero = await mkUser('t7_cajero', 'cajero');
    const player = await mkUser('t7_player', 'usuario_final');
    await setParent(empleado.id, socio.id, 'empleado_de_socio');
    await setParent(cajero.id, empleado.id, 'cajero_de_empleado');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(socio.id, 10);
    await setRate(cajero.id, 4);
    await insertRound(player.id, 100, 0, 'settled', P(period)); // NetWin 100

    const res = await compute(period);

    // El socio descuenta al cajero (nieto operador, saltando al empleado):
    // gross(socio) = (10−4)%·100 = 6 ; gross(cajero) = 4%·100 = 4. Total 10, NO 14.
    const rs = (await getRow(socio.id, P(period)))!;
    const rc = (await getRow(cajero.id, P(period)))!;
    expect(Number(rs.gross_commission)).toBeCloseTo(6, 2);
    expect(Number(rc.gross_commission)).toBeCloseTo(4, 2);
    // El empleado (no operador) no tiene fila.
    expect(await getRow(empleado.id, P(period))).toBeNull();
    expect(res.conservation.ok).toBe(true);
    expect(Number(res.totalGross)).toBeCloseTo(10, 2);
  });

  it('operador que juega: su propio NetWin no infla su comisión', async () => {
    const period = '2025-04';
    const cajero = await mkUser('t8_cajero', 'cajero');
    const player = await mkUser('t8_player', 'usuario_final');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(cajero.id, 5);
    await insertRound(player.id, 200, 0, 'settled', P(period)); // jugador: NetWin 200
    await insertRound(cajero.id, 1000, 0, 'settled', P(period)); // el cajero JUEGA: NetWin 1000

    const res = await compute(period);
    const rc = (await getRow(cajero.id, P(period)))!;
    // subNetWin = 200 (solo el jugador), NO 1200. gross = 5%·200 = 10.
    expect(Number(rc.sub_net_win)).toBeCloseTo(200, 2);
    expect(Number(rc.gross_commission)).toBeCloseTo(10, 2);
    // totalNetWin comisionable excluye el juego del operador.
    expect(Number(res.totalNetWin)).toBeCloseTo(200, 2);
  });

  it('idempotencia ante cambios: recompute borra la fila de un operador que dejó de emitir', async () => {
    const period = '2025-05';
    const cajero = await mkUser('t9_cajero', 'cajero');
    const player = await mkUser('t9_player', 'usuario_final');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(cajero.id, 5);
    await insertRound(player.id, 1000, 0, 'settled', P(period)); // NetWin 1000

    await compute(period);
    const before = (await getRow(cajero.id, P(period)))!;
    expect(Number(before.gross_commission)).toBeCloseTo(50, 2);

    // El round se anula (rolled_back) → el cajero ya no genera NetWin.
    await ctx.tenantDb.execute(
      sql`UPDATE game_rounds SET status = 'rolled_back', rolled_back_at = now()
          WHERE user_id = ${player.id} AND status = 'settled'`,
    );
    await compute(period);
    // La fila vieja (payable fantasma) NO debe quedar stale.
    expect(await getRow(cajero.id, P(period))).toBeNull();
  });

  it('flag independiente en un NO-socio (cajero) igual poda su rama', async () => {
    const period = '2025-02';
    const socio = await mkUser('t10_socio', 'socio');
    const cajeroInd = await mkUser('t10_cajeroInd', 'cajero');
    const playerInd = await mkUser('t10_playerInd', 'usuario_final');
    const cajeroNorm = await mkUser('t10_cajeroNorm', 'cajero');
    const playerNorm = await mkUser('t10_playerNorm', 'usuario_final');
    await setParent(cajeroInd.id, socio.id, 'cajero_de_socio');
    await setParent(playerInd.id, cajeroInd.id, 'jugador_de_cajero');
    await setParent(cajeroNorm.id, socio.id, 'cajero_de_socio');
    await setParent(playerNorm.id, cajeroNorm.id, 'jugador_de_cajero');
    await setRate(socio.id, 10);
    await setRate(cajeroInd.id, 5);
    await setRate(cajeroNorm.id, 5);
    // El flag independiente sobre el CAJERO (no socio).
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${cajeroInd.id}`,
    );
    await insertRound(playerInd.id, 1000, 0, 'settled', P(period)); // 1000 (excluido)
    await insertRound(playerNorm.id, 200, 0, 'settled', P(period)); // 200 (cuenta)

    const res = await compute(period);

    // La rama independiente (cajeroInd + su jugador) no tiene filas ni NetWin.
    expect(await getRow(cajeroInd.id, P(period))).toBeNull();
    // El socio cobra solo sobre la rama normal: gross = (10−5)%·200 = 10.
    const rs = (await getRow(socio.id, P(period)))!;
    expect(Number(rs.sub_net_win)).toBeCloseTo(200, 2);
    expect(Number(rs.gross_commission)).toBeCloseTo(10, 2);
    expect(Number(res.totalNetWin)).toBeCloseTo(200, 2);
    expect(res.conservation.ok).toBe(true);
  });
});
