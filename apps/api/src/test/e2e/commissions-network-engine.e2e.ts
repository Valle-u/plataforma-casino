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
  const providerGames = new Map<string, { gameId: string; sessionId: string }>();

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
    baseConsistency: { ok: boolean; nestedSocios: number };
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

  /** Compute crudo (sin tirar en non-200) para casos que esperan error. */
  async function computeRaw(period: string) {
    return ctx.request
      .post('/tenant/commissions/network/compute')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ period });
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
    clawback: string;
    provider_fee: string;
    status: string;
  } | null> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT sub_net_win, gross_commission, carryover_in, carryover_out, payable, clawback, provider_fee, status
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
        clawback: string;
        provider_fee: string;
        status: string;
      }>)[0] ?? null
    );
  }

  async function mkUser(label: string, role: string) {
    return createTestUser(ctx.request, adminToken, { suite: 'comm-net-engine', label, role });
  }

  /**
   * Crea (idempotente) un proveedor con su fee y un juego que le pertenece.
   * Códigos propios por test: cambiarle el fee a 'palace' rompería los demás
   * casos de la suite, que asumen fee 0.
   */
  async function ensureProviderGame(
    providerCode: string,
    feePct: number,
  ): Promise<{ gameId: string; sessionId: string }> {
    const cached = providerGames.get(providerCode);
    if (cached) return cached;
    await ctx.tenantDb.execute(
      sql`INSERT INTO game_providers (id, code, display_name, commission_fee_pct)
          VALUES (gen_random_uuid(), ${providerCode}, ${providerCode}, ${feePct.toFixed(2)})
          ON CONFLICT (code) DO UPDATE SET commission_fee_pct = ${feePct.toFixed(2)}`,
    );
    const gameCode = `netwin_test_game_${providerCode}`;
    await ctx.tenantDb.execute(
      sql`INSERT INTO games (id, code, name, category, provider_code)
          VALUES (gen_random_uuid(), ${gameCode}, ${gameCode}, 'slots', ${providerCode})
          ON CONFLICT (code) DO NOTHING`,
    );
    const g = await ctx.tenantDb.execute(
      sql`SELECT id FROM games WHERE code = ${gameCode} LIMIT 1`,
    );
    const gameId = (g as unknown as Array<{ id: string }>)[0]!.id;
    const s = await ctx.tenantDb.execute(
      sql`INSERT INTO game_sessions (id, user_id, game_id, provider_session_id)
          VALUES (gen_random_uuid(), ${adminId}, ${gameId}, ${`sess-${providerCode}`})
          RETURNING id`,
    );
    const sessionId = (s as unknown as Array<{ id: string }>)[0]!.id;
    const out = { gameId, sessionId };
    providerGames.set(providerCode, out);
    return out;
  }

  /** insertRound pero sobre un juego/proveedor concreto. Siempre 'settled'. */
  async function insertRoundOn(
    target: { gameId: string; sessionId: string },
    userId: string,
    bet: number,
    win: number,
    when: Date,
  ): Promise<void> {
    const net = (win - bet).toFixed(2);
    const ext = `nw-${roundSeq++}`;
    const whenIso = when.toISOString();
    await ctx.tenantDb.execute(
      sql`INSERT INTO game_rounds
            (id, session_id, user_id, game_id, round_external_id,
             bet_amount, win_amount, net_amount, status, placed_at, settled_at)
          VALUES
            (gen_random_uuid(), ${target.sessionId}, ${userId}, ${target.gameId}, ${ext},
             ${bet.toFixed(2)}, ${win.toFixed(2)}, ${net}, 'settled', ${whenIso}, ${whenIso})`,
    );
  }

  // ── Tests ────────────────────────────────────────────────────────────

  it('C1 diferencial: cada nivel cobra su override; el total queda capado a la tasa del socio', async () => {
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

    // Cadena de tasas (cada una ≤ la del padre): socio 10% > distrib 6% > cajero 4%.
    await setRate(socio.id, 10);
    await setRate(distrib.id, 6);
    await setRate(cajero.id, 4);

    // NetWin red = p1 (1000−600=+400) + p2 (500−700=−200) = 200.
    await insertRound(p1.id, 1000, 600, 'settled', P(period));
    await insertRound(p2.id, 500, 700, 'settled', P(period));

    const res = await compute(period);

    // Diferencial (override), subNetWin=200 en los tres niveles:
    //   socio   = 10%·200 − 6%·200 = 20 − 12 = 8
    //   distrib =  6%·200 − 4%·200 = 12 −  8 = 4
    //   cajero  =  4%·200 −      0 =        = 8
    //   total   = 20 = 10%·200 (cap a la tasa del nivel más alto)
    const rs = (await getRow(socio.id, P(period)))!;
    expect(Number(rs.sub_net_win)).toBeCloseTo(200, 2);
    expect(Number(rs.gross_commission)).toBeCloseTo(8, 2);
    expect(Number(rs.payable)).toBeCloseTo(8, 2);

    const rd = (await getRow(distrib.id, P(period)))!;
    expect(Number(rd.gross_commission)).toBeCloseTo(4, 2);
    expect(Number(rd.payable)).toBeCloseTo(4, 2);

    const rc = (await getRow(cajero.id, P(period)))!;
    expect(Number(rc.gross_commission)).toBeCloseTo(8, 2);
    expect(Number(rc.payable)).toBeCloseTo(8, 2);

    // El total que paga la Casa = 20 = cap a la tasa del socio (telescopa).
    const total =
      Number(rs.gross_commission) +
      Number(rd.gross_commission) +
      Number(rc.gross_commission);
    expect(total).toBeCloseTo(20, 2);

    // Ahora se computa una fila por CADA operador (socio + distrib + cajero).
    expect(res.sociosComputed).toBe(3);
    expect(res.baseConsistency.ok).toBe(true);

    // Endpoint de lectura: el admin ve las tres filas.
    const list = await ctx.request
      .get(`/tenant/commissions/network/periods?period=${period}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(list.status).toBe(200);
    const ids = (list.body.periods as Array<{ operatorUserId: string }>).map((p) => p.operatorUserId);
    expect(ids).toContain(socio.id);
    expect(ids).toContain(distrib.id);
    expect(ids).toContain(cajero.id);
  });

  it('C2 fail-closed: un hijo con % > su padre aborta el compute (markup invertido)', async () => {
    const period = '2025-09';
    const socio = await mkUser('t1b_socio', 'socio');
    const cajero = await mkUser('t1b_cajero', 'cajero');
    const player = await mkUser('t1b_player', 'usuario_final');
    await setParent(cajero.id, socio.id, 'cajero_de_socio');
    await setParent(player.id, cajero.id, 'jugador_de_cajero');
    // Markup invertido: cajero 8% > socio 5%. Seteamos por SQL para saltear la
    // validación del endpoint (simula config que quedó inconsistente).
    await setRate(socio.id, 5);
    await setRate(cajero.id, 8);
    await insertRound(player.id, 1000, 0, 'settled', P(period));

    const res = await ctx.request
      .post('/tenant/commissions/network/compute')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ period });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVERTED_MARKUP');

    // Limpieza CRÍTICA: el guard escanea TODOS los operadores del tenant, así
    // que si dejamos la config invertida, cualquier compute posterior (otros
    // tests) abortaría con 409. Reseteamos las tasas de este par.
    await setRate(socio.id, 0);
    await setRate(cajero.id, 0);
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

  it('clawback: una ronda anulada tras liquidar se descuenta del período abierto', async () => {
    const prev = '2026-01';
    const next = '2026-02';
    const socio = await mkUser('claw_socio', 'socio');
    const player = await mkUser('claw_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 10);

    // Enero: dos jugadas ganadas por la casa. NetWin +2000 → comisión 200.
    await insertRound(player.id, 1000, 0, 'settled', P(prev));
    await insertRound(player.id, 1000, 0, 'settled', P(prev));
    await compute(prev);
    expect(Number((await getRow(socio.id, P(prev)))!.gross_commission)).toBeCloseTo(
      200,
      2,
    );

    // Se liquida enero: la plata ya salió, no hay vuelta atrás.
    await ctx.tenantDb.execute(
      sql`UPDATE commission_network_periods SET status = 'paid', paid_at = now()
          WHERE period_start = ${P(prev).toISOString()}`,
    );

    // En febrero el proveedor anula UNA de las jugadas de enero.
    await ctx.tenantDb.execute(
      sql`UPDATE game_rounds
            SET status = 'rolled_back', rolled_back_at = ${P(next).toISOString()}
          WHERE user_id = ${player.id} AND status = 'settled'
                AND settled_at >= ${P(prev).toISOString()}
                AND settled_at < ${P(next).toISOString()}
          AND id = (SELECT id FROM game_rounds
                    WHERE user_id = ${player.id} AND status = 'settled' LIMIT 1)`,
    );

    // Febrero: NetWin propio +500, menos los 1000 anulados de enero → −500.
    await insertRound(player.id, 500, 0, 'settled', P(next));
    await compute(next);

    const feb = (await getRow(socio.id, P(next)))!;
    // El clawback queda a la vista, separado de la base.
    expect(Number(feb.clawback)).toBeCloseTo(1000, 2);
    expect(Number(feb.sub_net_win)).toBeCloseTo(-500, 2); // 500 − 1000
    expect(Number(feb.gross_commission)).toBeCloseTo(-50, 2); // 10% de −500
    expect(Number(feb.payable)).toBeCloseTo(0, 2); // negativo → arrastra
    expect(Number(feb.carryover_out)).toBeCloseTo(-50, 2);

    // Enero NO se tocó: ya estaba pagado.
    const ene = (await getRow(socio.id, P(prev)))!;
    expect(ene.status).toBe('paid');
    expect(Number(ene.gross_commission)).toBeCloseTo(200, 2);
  });

  it('clawback: NO se descuenta si el período original sigue sin liquidar', async () => {
    // Si queda alguna fila en `accrued`, recomputar ese período ya excluye la
    // ronda anulada. Descontarla acá también sería corregir dos veces.
    const prev = '2026-03';
    const next = '2026-04';
    const socio = await mkUser('claw2_socio', 'socio');
    const player = await mkUser('claw2_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 10);

    await insertRound(player.id, 1000, 0, 'settled', P(prev));
    await compute(prev); // queda 'accrued', NO se liquida

    await ctx.tenantDb.execute(
      sql`UPDATE game_rounds
            SET status = 'rolled_back', rolled_back_at = ${P(next).toISOString()}
          WHERE user_id = ${player.id} AND status = 'settled'`,
    );

    await insertRound(player.id, 300, 0, 'settled', P(next));
    await compute(next);

    const abr = (await getRow(socio.id, P(next)))!;
    expect(Number(abr.clawback)).toBeCloseTo(0, 2);
    expect(Number(abr.sub_net_win)).toBeCloseTo(300, 2); // sin descuento
  });

  it('recomputar un período viejo recomputa EN CASCADA los posteriores', async () => {
    // Sin cascada, el carryover del mes siguiente queda viejo y sus números
    // pasan a estar mal en silencio.
    const prev = '2025-09';
    const next = '2025-10';
    const socio = await mkUser('casc_socio', 'socio');
    const player = await mkUser('casc_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 10);

    await insertRound(player.id, 0, 500, 'settled', P(prev)); // NetWin −500
    await compute(prev);
    await insertRound(player.id, 1000, 0, 'settled', P(next)); // NetWin +1000
    await compute(next);

    expect(Number((await getRow(socio.id, P(next)))!.carryover_in)).toBeCloseTo(
      -50,
      2,
    );

    // Aparece una jugada más en el mes VIEJO → su arrastre cambia.
    await insertRound(player.id, 0, 500, 'settled', P(prev)); // NetWin −1000
    const res = await compute(prev);

    expect(Number((await getRow(socio.id, P(prev)))!.carryover_out)).toBeCloseTo(
      -100,
      2,
    );
    // Lo que importa: octubre se recalculó solo, con el arrastre nuevo.
    const oct = (await getRow(socio.id, P(next)))!;
    expect(Number(oct.carryover_in)).toBeCloseTo(-100, 2);
    expect(Number(oct.payable)).toBeCloseTo(0, 2); // 100 de gross − 100 de deuda
    // Y la respuesta declara qué períodos arrastró.
    expect(
      (res as unknown as { cascadedPeriods: string[] }).cascadedPeriods.length,
    ).toBeGreaterThan(0);
  });

  it('recomputar usa la tasa DE ENTONCES, no la actual', async () => {
    const period = '2025-11';
    const socio = await mkUser('snap_socio', 'socio');
    const player = await mkUser('snap_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 20);

    await insertRound(player.id, 1000, 0, 'settled', P(period)); // NetWin +1000
    await compute(period);
    expect(Number((await getRow(socio.id, P(period)))!.gross_commission)).toBeCloseTo(
      200,
      2,
    );

    // Se le baja la tasa HOY. El pasado no se toca.
    await setRate(socio.id, 5);
    await compute(period);

    const r = (await getRow(socio.id, P(period)))!;
    expect(Number(r.gross_commission)).toBeCloseTo(200, 2); // 20%, no 5%
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

  it('socios anidados: el invariante estructural aborta el compute (fail-closed)', async () => {
    const period = '2025-12';
    const socioA = await mkUser('t7_socioA', 'socio');
    const socioB = await mkUser('t7_socioB', 'socio');
    const player = await mkUser('t7_player', 'usuario_final');
    await setParent(socioB.id, socioA.id, 'socio_de_socio'); // anidado (prohibido)
    await setParent(player.id, socioB.id, 'jugador_de_socio');
    await setRate(socioA.id, 10);
    await setRate(socioB.id, 8);
    await insertRound(player.id, 1000, 0, 'settled', P(period));

    const res = await computeRaw(period);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('CONSERVATION_VIOLATED');

    // Limpiar el anidamiento para no romper los demás computes (chequeo global).
    await ctx.tenantDb.execute(
      sql`DELETE FROM user_hierarchy WHERE user_id IN (${socioB.id}, ${player.id})`,
    );
  });

  it('socio sin jugadores: no emite fila', async () => {
    const period = '2024-12';
    const socio = await mkUser('t8_socio', 'socio');
    await setRate(socio.id, 10);
    await compute(period);
    expect(await getRow(socio.id, P(period))).toBeNull();
  });

  it('jugador colgado del admin (sin socio): no rompe el invariante', async () => {
    const period = '2024-11';
    const player = await mkUser('t9_player', 'usuario_final');
    await setParent(player.id, adminId, 'jugador_de_admin');
    await insertRound(player.id, 500, 0, 'settled', P(period)); // NetWin 500

    const res = await compute(period);
    expect(res.baseConsistency.ok).toBe(true);
    expect(res.sociosComputed).toBe(0); // ningún socio lo cobra
    expect(Number(res.totalNetWin)).toBeCloseTo(500, 2);

    await ctx.tenantDb.execute(
      sql`DELETE FROM user_hierarchy WHERE user_id = ${player.id}`,
    );
  });

  it('deuda de ex-socio se arrastra aunque deje de ser socio (independiente)', async () => {
    const prev = '2024-09';
    const next = '2024-10';
    const socio = await mkUser('t10_socio', 'socio');
    const player = await mkUser('t10_player', 'usuario_final');
    await setParent(player.id, socio.id, 'jugador_de_socio');
    await setRate(socio.id, 5);
    await insertRound(player.id, 1000, 2000, 'settled', P(prev)); // NetWin −1000 → gross −50

    await compute(prev);
    const r1 = (await getRow(socio.id, P(prev)))!;
    expect(Number(r1.carryover_out)).toBeCloseTo(-50, 2);

    // El socio se vuelve independiente → ya no es socio liquidable.
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${socio.id}`,
    );
    await compute(next);
    // La deuda NO desaparece: se arrastra en su propia fila (payable 0).
    const r2 = (await getRow(socio.id, P(next)))!;
    expect(r2).not.toBeNull();
    expect(Number(r2.carryover_in)).toBeCloseTo(-50, 2);
    expect(Number(r2.carryover_out)).toBeCloseTo(-50, 2);
    expect(Number(r2.payable)).toBeCloseTo(0, 2);
  });

  // ── Fee del proveedor (LEY C4b) ──────────────────────────────────────
  //
  // El fee no es una tasa única de la Casa: cada proveedor cobra la suya
  // sobre la NetWin que generó. Dos redes con la MISMA NetWin pero mezcla
  // de proveedores opuesta tienen que pagar fees DISTINTOS.
  //
  // Período 2026-06: posterior a todos los demás de la suite, así la
  // cascada de este compute no recomputa períodos ajenos.
  it('fee del proveedor: cada operador paga el fee de los proveedores que jugó SU red', async () => {
    const period = '2026-06';

    // Dos proveedores con fees muy distintos, con códigos propios para no
    // tocar 'palace' (fee 0, asumido por el resto de la suite).
    const lo = await ensureProviderGame('feetest_lo', 5); // barato
    const hi = await ensureProviderGame('feetest_hi', 25); // caro

    const socioLo = await mkUser('t11_socio_lo', 'socio');
    const socioHi = await mkUser('t11_socio_hi', 'socio');
    const pLo = await mkUser('t11_p_lo', 'usuario_final');
    const pHi = await mkUser('t11_p_hi', 'usuario_final');
    await setParent(pLo.id, socioLo.id, 'jugador_de_socio');
    await setParent(pHi.id, socioHi.id, 'jugador_de_socio');
    await setRate(socioLo.id, 10);
    await setRate(socioHi.id, 10);

    // Misma NetWin (1000) para los dos; cada red juega un solo proveedor.
    // La ÚNICA diferencia entre ambos operadores es el fee del proveedor.
    await insertRoundOn(lo, pLo.id, 3000, 2000, P(period));
    await insertRoundOn(hi, pHi.id, 3000, 2000, P(period));

    await compute(period);

    const rLo = (await getRow(socioLo.id, P(period)))!;
    const rHi = (await getRow(socioHi.id, P(period)))!;

    // NetWin idéntica: el fee es lo único que puede diferenciarlos.
    expect(Number(rLo.sub_net_win)).toBeCloseTo(1000, 2);
    expect(Number(rHi.sub_net_win)).toBeCloseTo(1000, 2);

    // Fee = el del proveedor que jugó CADA red, no un promedio global:
    //   lo:  1000 × 5%  =  50  → base 950 → gross 10%·950 = 95
    //   hi:  1000 × 25% = 250  → base 750 → gross 10%·750 = 75
    //
    // Con el promedio ponderado global —(1000·5 + 1000·25)/2000 = 15%— los
    // dos darían fee 150 y gross 85: el que juega barato le subsidia el
    // costo al que juega caro, y la Casa nunca cierra contra lo que paga.
    expect(Number(rLo.provider_fee)).toBeCloseTo(50, 2);
    expect(Number(rHi.provider_fee)).toBeCloseTo(250, 2);
    expect(Number(rLo.gross_commission)).toBeCloseTo(95, 2);
    expect(Number(rHi.gross_commission)).toBeCloseTo(75, 2);

    // Los fees que descuenta el motor tienen que sumar exactamente lo que la
    // Casa le paga a los proveedores (mismo criterio que house-pnl).
    expect(Number(rLo.provider_fee) + Number(rHi.provider_fee)).toBeCloseTo(300, 2);
  });
});
