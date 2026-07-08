/**
 * E2E: §14.4 — corte de comisión por flip mid-período (ventaneo).
 *
 * Un socio que flipea a mitad de mes solo debe cobrar comisión por el TRAMO
 * DEPENDIENTE. El engine ventanea la NetWin por `commission_eligible_from/until`:
 *   - dep→indep (until = flip): cuenta rounds settled ANTES del flip.
 *   - indep→dep (from = flip): cuenta rounds settled DESPUÉS del flip.
 * Antes de esto: dep→indep perdía el mes entero; indep→dep lo cobraba entero.
 */

import { sql } from 'drizzle-orm';
import { loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

const P = (ym: string): Date => new Date(`${ym}-01T00:00:00.000Z`);

describe('Commissions flip windowing (§14.4, E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;
  let gameSession: { gameId: string; sessionId: string } | null = null;
  let roundSeq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    const a = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username} LIMIT 1`,
    );
    adminId = (a as unknown as Array<{ id: string }>)[0]!.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function ensureGameSession() {
    if (gameSession) return gameSession;
    await ctx.tenantDb.execute(
      sql`INSERT INTO games (id, code, name, category)
          VALUES (gen_random_uuid(), 'flipwin_game', 'FlipWin', 'slots')
          ON CONFLICT (code) DO NOTHING`,
    );
    const g = await ctx.tenantDb.execute(
      sql`SELECT id FROM games WHERE code = 'flipwin_game' LIMIT 1`,
    );
    const gameId = (g as unknown as Array<{ id: string }>)[0]!.id;
    const s = await ctx.tenantDb.execute(
      sql`INSERT INTO game_sessions (id, user_id, game_id, provider_session_id)
          VALUES (gen_random_uuid(), ${adminId}, ${gameId}, 'flipwin-sess')
          RETURNING id`,
    );
    const sessionId = (s as unknown as Array<{ id: string }>)[0]!.id;
    gameSession = { gameId, sessionId };
    return gameSession;
  }

  async function insertRound(userId: string, bet: number, win: number, when: Date) {
    const { gameId, sessionId } = await ensureGameSession();
    const ext = `fw-${roundSeq++}`;
    await ctx.tenantDb.execute(
      sql`INSERT INTO game_rounds
            (id, session_id, user_id, game_id, round_external_id,
             bet_amount, win_amount, net_amount, status, placed_at, settled_at)
          VALUES
            (gen_random_uuid(), ${sessionId}, ${userId}, ${gameId}, ${ext},
             ${bet.toFixed(2)}, ${win.toFixed(2)}, ${(win - bet).toFixed(2)},
             'settled', ${when.toISOString()}, ${when.toISOString()})`,
    );
  }

  async function mkUser(label: string, role: string) {
    return createTestUser(ctx.request, adminToken, {
      suite: 'flip-win',
      label,
      role,
    });
  }

  async function setParent(childId: string, parentId: string, rel: string) {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType: rel });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`setParent falló ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function compute(period: string) {
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

  async function getRow(operatorId: string, periodStart: Date) {
    const r = await ctx.tenantDb.execute(
      sql`SELECT sub_net_win, gross_commission
          FROM commission_network_periods
          WHERE operator_user_id = ${operatorId} AND period_start = ${periodStart.toISOString()}
          LIMIT 1`,
    );
    return (
      (r as unknown as Array<{ sub_net_win: string; gross_commission: string }>)[0] ??
      null
    );
  }

  it('dep→indep mid-mes: cuenta solo el tramo DEPENDIENTE (antes del flip)', async () => {
    const period = '2026-05';
    const socio = await mkUser('s_di', 'socio');
    const player = await mkUser('p_di', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await ctx.tenantDb.execute(
      sql`UPDATE users SET commission_rate = '10.00' WHERE id = ${socio.id}`,
    );
    // NetWin: +1000 el día 10 (dependiente), +500 el día 20 (ya independiente).
    await insertRound(player.id, 1000, 0, new Date('2026-05-10T00:00:00Z'));
    await insertRound(player.id, 500, 0, new Date('2026-05-20T00:00:00Z'));
    // Flip dep→indep el día 15: hoy independiente + eligible_until = flip.
    await ctx.tenantDb.execute(
      sql`UPDATE users
          SET is_independent_branch = true,
              commission_eligible_until = '2026-05-15T00:00:00Z'
          WHERE id = ${socio.id}`,
    );

    await compute(period);
    const row = (await getRow(socio.id, P(period)))!;
    // Solo el tramo dependiente (1000) cuenta; gross = 10%·1000 = 100.
    expect(Number(row.sub_net_win)).toBeCloseTo(1000, 2);
    expect(Number(row.gross_commission)).toBeCloseTo(100, 2);
  });

  it('indep→dep mid-mes: cuenta solo el tramo DEPENDIENTE (después del flip)', async () => {
    const period = '2026-06';
    const socio = await mkUser('s_id', 'socio');
    const player = await mkUser('p_id', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await ctx.tenantDb.execute(
      sql`UPDATE users SET commission_rate = '10.00' WHERE id = ${socio.id}`,
    );
    // NetWin: +1000 el día 10 (aún independiente), +500 el día 20 (dependiente).
    await insertRound(player.id, 1000, 0, new Date('2026-06-10T00:00:00Z'));
    await insertRound(player.id, 500, 0, new Date('2026-06-20T00:00:00Z'));
    // Flip indep→dep el día 15: hoy dependiente + eligible_from = flip.
    await ctx.tenantDb.execute(
      sql`UPDATE users
          SET is_independent_branch = false,
              commission_eligible_from = '2026-06-15T00:00:00Z'
          WHERE id = ${socio.id}`,
    );

    await compute(period);
    const row = (await getRow(socio.id, P(period)))!;
    // Solo el tramo dependiente (500) cuenta; gross = 10%·500 = 50.
    expect(Number(row.sub_net_win)).toBeCloseTo(500, 2);
    expect(Number(row.gross_commission)).toBeCloseTo(50, 2);
  });
});
