/**
 * E2E: F1 · Deducciones operativas — DORMIDO (LEY C4).
 *
 * Por LEY C4 la comisión vigente es NetWin puro → comisión, SIN deducciones
 * (sueldos + costo bancario + costo plataforma). El bloque F1 quedó DORMIDO tras
 * el flag `DEDUCTIONS_ENABLED=false` (network-commissions.service.ts, 2026-07-08).
 *
 * Esta suite BLINDA C4: aunque se configuren sueldos y settings de costo
 * agresivos, el motor NO deduce nada — las columnas deductions_* quedan en 0 y
 * `final_commission == payable`, así que el settle paga el `payable` completo.
 *
 * Cuando se revida el "módulo de costos" (DEDUCTIONS_ENABLED=true), reactivar
 * las aserciones de deducción activa (ver historial git de este archivo).
 *
 * Casos:
 *   1. Con settings de costo cargados → deducciones=0, final=payable=gross.
 *   2. Con sueldos > gross → NO reducen; se paga el payable completo (no 0).
 *   3. Socio INDEPENDIENTE → sin fila (baseline preservado; poda de la rama).
 *   4. settle paga el `payable` (F1 dormido → sin recorte).
 */

import { sql } from 'drizzle-orm';
import { loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

const P = (ym: string): Date => new Date(`${ym}-01T00:00:00.000Z`);

describe('Commissions network — F1 deductions DORMANT (C4, E2E)', () => {
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

    // Neutralizamos settings pre-existentes para partir del default documentado
    // (bank=0.01, platform=0) y arrancar cada test con delta explícito.
    await ctx.tenantDb.execute(
      sql`DELETE FROM tenant_settings WHERE key IN ('commissions.bank_cost_pct_of_netwin', 'commissions.platform_cost_flat')`,
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  async function ensureGameSession() {
    if (gameSession) return gameSession;
    await ctx.tenantDb.execute(
      sql`INSERT INTO games (id, code, name, category)
          VALUES (gen_random_uuid(), 'netwin_ded_game', 'NetWin Ded', 'slots')
          ON CONFLICT (code) DO NOTHING`,
    );
    const g = await ctx.tenantDb.execute(
      sql`SELECT id FROM games WHERE code = 'netwin_ded_game' LIMIT 1`,
    );
    const gameId = (g as unknown as Array<{ id: string }>)[0]!.id;
    const s = await ctx.tenantDb.execute(
      sql`INSERT INTO game_sessions (id, user_id, game_id, provider_session_id)
          VALUES (gen_random_uuid(), ${adminId}, ${gameId}, 'netwin-ded-sess')
          RETURNING id`,
    );
    const sessionId = (s as unknown as Array<{ id: string }>)[0]!.id;
    gameSession = { gameId, sessionId };
    return gameSession;
  }

  async function insertRound(userId: string, bet: number, win: number, when: Date) {
    const { gameId, sessionId } = await ensureGameSession();
    const ext = `nwd-${roundSeq++}`;
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
    return createTestUser(ctx.request, adminToken, {
      suite: 'comm-net-ded',
      label,
      role,
    });
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

  async function setSetting(key: string, value: number) {
    const r = await ctx.request
      .patch(`/tenant/settings/${key}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ value });
    if (r.status !== 200) {
      throw new Error(`setting falló: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function setSalary(userId: string, monthlyAmount: number) {
    const r = await ctx.request
      .put(`/tenant/employees/${userId}/salary`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ monthlyAmount });
    if (r.status !== 200) {
      throw new Error(`setSalary falló: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function getRow(operatorId: string, periodStart: Date) {
    const r = await ctx.tenantDb.execute(
      sql`SELECT sub_net_win, gross_commission, payable,
                 deductions_salaries, deductions_bank_cost,
                 deductions_platform_cost, final_commission, status
          FROM commission_network_periods
          WHERE operator_user_id = ${operatorId}
            AND period_start = ${periodStart.toISOString()}
          LIMIT 1`,
    );
    return (
      (r as unknown as Array<{
        sub_net_win: string;
        gross_commission: string;
        payable: string;
        deductions_salaries: string;
        deductions_bank_cost: string;
        deductions_platform_cost: string;
        final_commission: string;
        status: string;
      }>)[0] ?? null
    );
  }

  async function getBalance(userId: string): Promise<number> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    );
    return Number(
      (r as unknown as Array<{ balance: string }>)[0]?.balance ?? '0',
    );
  }

  async function settle(body: Record<string, unknown>) {
    const res = await ctx.request
      .post('/tenant/commissions/network/settle')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send(body);
    if (res.status !== 200) {
      throw new Error(`settle falló: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as {
      settled: number;
      failed: number;
      totalPaid: string;
    };
  }

  // ── Tests ────────────────────────────────────────────────────────────

  it('F1 dormido: con settings de costo cargados, deducciones=0 y final=payable', async () => {
    const period = '2026-01';
    const socio = await mkUser('d1_socio', 'socio');
    const player = await mkUser('d1_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 10);
    // NetWin sub-red = 1000 → gross = 10% × 1000 = 100.
    await insertRound(player.id, 1000, 0, P(period));

    // Settings de costo AGRESIVOS: deben ser ignorados (F1 dormido).
    await setSetting('commissions.bank_cost_pct_of_netwin', 0.02);
    await setSetting('commissions.platform_cost_flat', 5);

    const res = await compute(period);
    const row = (await getRow(socio.id, P(period)))!;

    expect(Number(row.sub_net_win)).toBeCloseTo(1000, 2);
    expect(Number(row.gross_commission)).toBeCloseTo(100, 2);
    expect(Number(row.payable)).toBeCloseTo(100, 2);

    // C4: NADA se deduce.
    expect(Number(row.deductions_salaries)).toBeCloseTo(0, 2);
    expect(Number(row.deductions_bank_cost)).toBeCloseTo(0, 2);
    expect(Number(row.deductions_platform_cost)).toBeCloseTo(0, 2);
    // final = payable (sin recorte).
    expect(Number(row.final_commission)).toBeCloseTo(100, 2);

    // Agregados del compute: deducciones globales en 0, final = payable.
    expect(Number(res.totalDeductionsSalaries)).toBeCloseTo(0, 2);
    expect(Number(res.totalDeductionsBankCost)).toBeCloseTo(0, 2);
    expect(Number(res.totalDeductionsPlatformCost)).toBeCloseTo(0, 2);
    expect(Number(res.totalFinalCommission)).toBeGreaterThanOrEqual(100);
  });

  it('F1 dormido: sueldos > gross NO reducen; se paga el payable completo', async () => {
    const period = '2026-02';
    const socio = await mkUser('d2_socio', 'socio');
    const cajero = await mkUser('d2_cajero', 'cajero');
    const emp = await mkUser('d2_emp', 'empleado');
    const player = await mkUser('d2_player', 'usuario_final');
    await setParent(cajero.id, socio.id, 'cajero_de_socio');
    await setParent(emp.id, cajero.id, 'empleado_de_cajero');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(socio.id, 10);
    // NetWin sub-red = 1000 → gross = 100.
    await insertRound(player.id, 1000, 0, P(period));

    // Sueldos que superarían el gross (100): cajero=200 + empleado=150 = 350.
    // Con F1 dormido, NO se descuentan.
    await setSalary(cajero.id, 200);
    await setSalary(emp.id, 150);
    await setSetting('commissions.bank_cost_pct_of_netwin', 0);
    await setSetting('commissions.platform_cost_flat', 0);

    await compute(period);
    const row = (await getRow(socio.id, P(period)))!;

    expect(Number(row.gross_commission)).toBeCloseTo(100, 2);
    expect(Number(row.payable)).toBeCloseTo(100, 2);
    expect(Number(row.deductions_salaries)).toBeCloseTo(0, 2);
    // final = payable (los sueldos NO recortan).
    expect(Number(row.final_commission)).toBeCloseTo(100, 2);

    // settle SÍ paga (100): la Casa quema 100 (antes, con F1, pagaba 0).
    const socioBefore = await getBalance(socio.id);
    const casaBefore = await getBalance(casaId);
    const settleRes = await settle({ period });
    expect(settleRes.settled).toBe(1);
    expect(Number(settleRes.totalPaid)).toBeCloseTo(100, 2);
    // El socio cobra por fuera (no recibe fichas); la Casa quemó 100.
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore, 2);
    expect(await getBalance(casaId)).toBeCloseTo(casaBefore - 100, 2);

    const rowAfter = (await getRow(socio.id, P(period)))!;
    expect(rowAfter.status).toBe('paid');
  });

  it('socio INDEPENDIENTE: baseline preservado — no genera fila ni deducciones', async () => {
    const period = '2026-03';
    const socioIndep = await mkUser('d3_socioI', 'socio');
    const cajero = await mkUser('d3_cajero', 'cajero');
    const player = await mkUser('d3_player', 'usuario_final');
    await setParent(cajero.id, socioIndep.id, 'cajero_de_socio');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(socioIndep.id, 10);
    // Marcar socio como independiente → toda su rama se poda.
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${socioIndep.id}`,
    );

    // Aún con NetWin real + sueldos + settings agresivos, el socio indep no
    // aparece — el motor lo saltea entero.
    await insertRound(player.id, 5000, 0, P(period)); // NetWin 5000 (excluido)
    await setSalary(cajero.id, 999999);
    await setSetting('commissions.bank_cost_pct_of_netwin', 0.5);
    await setSetting('commissions.platform_cost_flat', 100000);

    const res = await compute(period);
    expect(await getRow(socioIndep.id, P(period))).toBeNull();
    // El único operador con tasa del test es indep → no hay filas emitidas.
    expect(res.sociosComputed).toBe(0);
    expect(Number(res.totalDeductionsSalaries)).toBeCloseTo(0, 2);
    expect(Number(res.totalDeductionsBankCost)).toBeCloseTo(0, 2);
    expect(Number(res.totalDeductionsPlatformCost)).toBeCloseTo(0, 2);
    expect(Number(res.totalFinalCommission)).toBeCloseTo(0, 2);
  });

  it('settle paga el `payable` completo (F1 dormido → sin recorte)', async () => {
    const period = '2026-04';
    const socio = await mkUser('d4_socio', 'socio');
    const cajero = await mkUser('d4_cajero', 'cajero');
    const player = await mkUser('d4_player', 'usuario_final');
    await setParent(cajero.id, socio.id, 'cajero_de_socio');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    await setRate(socio.id, 10);
    // NetWin 2000 → gross 200.
    await insertRound(player.id, 2000, 0, P(period));

    // Costos que, con F1 activo, habrían recortado a 140. Dormido → se ignoran.
    await setSalary(cajero.id, 30);
    await setSetting('commissions.bank_cost_pct_of_netwin', 0.01);
    await setSetting('commissions.platform_cost_flat', 10);

    await compute(period);
    const row = (await getRow(socio.id, P(period)))!;
    expect(Number(row.payable)).toBeCloseTo(200, 2);
    // final = payable (sin recorte por costos).
    expect(Number(row.final_commission)).toBeCloseTo(200, 2);

    const socioBefore = await getBalance(socio.id);
    const casaBefore = await getBalance(casaId);

    const settleRes = await settle({ period });
    expect(settleRes.settled).toBe(1);
    expect(Number(settleRes.totalPaid)).toBeCloseTo(200, 2);

    // El socio NO recibe fichas (cobra por fuera); la Casa QUEMÓ 200 (no 140).
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore, 2);
    expect(await getBalance(casaId)).toBeCloseTo(casaBefore - 200, 2);

    const rowAfter = (await getRow(socio.id, P(period)))!;
    expect(rowAfter.status).toBe('paid');
  });
});
