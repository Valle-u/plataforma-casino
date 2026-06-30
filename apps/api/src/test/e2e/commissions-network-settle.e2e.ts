/**
 * E2E: liquidación de comisiones por red — C3.
 * docs/16-tesoreria.md §11.
 *
 * La plataforma liquida a los SOCIOS su `payable`:
 *   - 'chips': transfer Casa → socio (las fichas siguen en la plataforma).
 *   - 'cash':  la Casa QUEMA el equivalente en fichas (la plata sale por fuera);
 *     el socio NO recibe fichas. Guarda referencia opcional.
 * Idempotente: solo toca filas 'accrued'.
 */

import { sql } from 'drizzle-orm';
import { loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

const P = (ym: string): Date => new Date(`${ym}-01T00:00:00.000Z`);

describe('Commissions network settle (C3, E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;
  let casaId: string;
  let gameSession: { gameId: string; sessionId: string } | null = null;
  let roundSeq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    const aRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username} LIMIT 1`,
    );
    adminId = (aRow as unknown as Array<{ id: string }>)[0]!.id;
    const cRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = '__casa__' LIMIT 1`,
    );
    casaId = (cRow as unknown as Array<{ id: string }>)[0]!.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function ensureGameSession() {
    if (gameSession) return gameSession;
    await ctx.tenantDb.execute(
      sql`INSERT INTO games (id, code, name, category)
          VALUES (gen_random_uuid(), 'netwin_settle_game', 'NetWin Settle', 'slots')
          ON CONFLICT (code) DO NOTHING`,
    );
    const g = await ctx.tenantDb.execute(
      sql`SELECT id FROM games WHERE code = 'netwin_settle_game' LIMIT 1`,
    );
    const gameId = (g as unknown as Array<{ id: string }>)[0]!.id;
    const s = await ctx.tenantDb.execute(
      sql`INSERT INTO game_sessions (id, user_id, game_id, provider_session_id)
          VALUES (gen_random_uuid(), ${adminId}, ${gameId}, 'netwin-settle-sess')
          RETURNING id`,
    );
    const sessionId = (s as unknown as Array<{ id: string }>)[0]!.id;
    gameSession = { gameId, sessionId };
    return gameSession;
  }

  async function insertRound(userId: string, bet: number, win: number, when: Date) {
    const { gameId, sessionId } = await ensureGameSession();
    const ext = `nws-${roundSeq++}`;
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

  async function setRate(userId: string, rate: number) {
    await ctx.tenantDb.execute(
      sql`UPDATE users SET commission_rate = ${rate.toFixed(2)} WHERE id = ${userId}`,
    );
  }

  async function setParent(childId: string, parentId: string, rel: string) {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType: rel });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`setParent falló: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function mkUser(label: string, role: string) {
    return createTestUser(ctx.request, adminToken, { suite: 'comm-net-settle', label, role });
  }

  async function compute(period: string) {
    const res = await ctx.request
      .post('/tenant/commissions/network/compute')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ period });
    if (res.status !== 200) throw new Error(`compute falló: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function settle(body: Record<string, unknown>): Promise<{
    settled: number;
    failed: number;
    totalPaid: string;
    results: Array<{ id: string; ok: boolean; error?: string }>;
  }> {
    const res = await ctx.request
      .post('/tenant/commissions/network/settle')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send(body);
    if (res.status !== 200) throw new Error(`settle falló: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function getBalance(userId: string): Promise<number> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    );
    return Number((r as unknown as Array<{ balance: string }>)[0]?.balance ?? '0');
  }

  async function getRow(socioId: string, periodStart: Date) {
    const r = await ctx.tenantDb.execute(
      sql`SELECT status, settlement_method, settlement_reference, wallet_tx_id, payable
          FROM commission_network_periods
          WHERE operator_user_id = ${socioId} AND period_start = ${periodStart.toISOString()}
          LIMIT 1`,
    );
    return (
      (r as unknown as Array<{
        status: string;
        settlement_method: string | null;
        settlement_reference: string | null;
        wallet_tx_id: string | null;
        payable: string;
      }>)[0] ?? null
    );
  }

  it('liquida en fichas: Casa → socio, fila paid, idempotente', async () => {
    const period = '2025-02';
    const socio = await mkUser('c1_socio', 'socio');
    const player = await mkUser('c1_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 10);
    await insertRound(player.id, 1000, 0, P(period)); // NetWin 1000 → gross 100
    await compute(period);

    const socioBefore = await getBalance(socio.id);
    const casaBefore = await getBalance(casaId);

    const res = await settle({ period, method: 'chips' });
    expect(res.settled).toBe(1);
    expect(Number(res.totalPaid)).toBeCloseTo(100, 2);

    // El socio recibió 100 fichas; la Casa pagó 100 (las fichas siguen en plataforma).
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore + 100, 2);
    expect(await getBalance(casaId)).toBeCloseTo(casaBefore - 100, 2);

    const row = (await getRow(socio.id, P(period)))!;
    expect(row.status).toBe('paid');
    expect(row.settlement_method).toBe('chips');
    expect(row.wallet_tx_id).not.toBeNull();

    // Idempotencia: re-liquidar no vuelve a pagar.
    const res2 = await settle({ period, method: 'chips' });
    expect(res2.settled).toBe(0);
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore + 100, 2);
  });

  it('liquida en plata real: quema fichas de la Casa, socio sin fichas, referencia', async () => {
    const period = '2025-03';
    const socio = await mkUser('c2_socio', 'socio');
    const player = await mkUser('c2_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 10);
    await insertRound(player.id, 2000, 0, P(period)); // NetWin 2000 → gross 200
    await compute(period);

    const socioBefore = await getBalance(socio.id);
    const casaBefore = await getBalance(casaId);

    const res = await settle({ period, method: 'cash', reference: 'TRANSFER-XYZ-123' });
    expect(res.settled).toBe(1);
    expect(Number(res.totalPaid)).toBeCloseTo(200, 2);

    // El socio NO recibe fichas (cobró por fuera); la Casa QUEMÓ 200.
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore, 2);
    expect(await getBalance(casaId)).toBeCloseTo(casaBefore - 200, 2);

    const row = (await getRow(socio.id, P(period)))!;
    expect(row.status).toBe('paid');
    expect(row.settlement_method).toBe('cash');
    expect(row.settlement_reference).toBe('TRANSFER-XYZ-123');
    expect(row.wallet_tx_id).not.toBeNull();
  });

  it('settle parcial no congela el recompute del resto del período', async () => {
    const period = '2025-01';
    const socioA = await mkUser('c3_socioA', 'socio');
    const socioB = await mkUser('c3_socioB', 'socio');
    const pA = await mkUser('c3_pA', 'usuario_final');
    const pB = await mkUser('c3_pB', 'usuario_final');
    await setParent(pA.id, socioA.id, 'jugador_de_socio');
    await setParent(pB.id, socioB.id, 'jugador_de_socio');
    await setRate(socioA.id, 10);
    await setRate(socioB.id, 10);
    await insertRound(pA.id, 1000, 0, P(period)); // socioA gross 100
    await insertRound(pB.id, 500, 0, P(period)); // socioB gross 50
    await compute(period);

    const idRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM commission_network_periods
          WHERE operator_user_id = ${socioA.id} AND period_start = ${P(period).toISOString()} LIMIT 1`,
    );
    const idA = (idRow as unknown as Array<{ id: string }>)[0]!.id;

    // Liquidar SOLO a socioA (por rowId).
    const res = await settle({ rowIds: [idA], method: 'chips' });
    expect(res.settled).toBe(1);
    expect((await getRow(socioA.id, P(period)))!.status).toBe('paid');
    expect((await getRow(socioB.id, P(period)))!.status).toBe('accrued');

    // Recomputar NO debe fallar: socioA (paid) se preserva, socioB se recomputa.
    const recompute = await ctx.request
      .post('/tenant/commissions/network/compute')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ period });
    expect(recompute.status).toBe(200);
    expect((await getRow(socioA.id, P(period)))!.status).toBe('paid');
    const rB = (await getRow(socioB.id, P(period)))!;
    expect(rB.status).toBe('accrued');
    expect(Number(rB.payable)).toBeCloseTo(50, 2);
  });
});
