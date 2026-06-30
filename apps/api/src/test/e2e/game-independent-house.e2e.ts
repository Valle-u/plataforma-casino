/**
 * E2E: el juego de un jugador que cuelga de una sucursal INDEPENDIENTE lo
 * banca el OPERADOR independiente (su wallet), no la Casa del tenant.
 *
 * Modelo (decisión del dueño): el independiente compra fichas a la Casa y
 * banca COMPLETAMENTE el riesgo de juego de su red. La Casa solo banca a los
 * jugadores "tenant-wide" (sin independiente arriba).
 *
 * Cobertura:
 *   1. Jugador bajo independiente → bet va a / win sale de la wallet del
 *      operador; la Casa queda INTACTA; player+operador se conservan (cualquier
 *      resultado del RNG).
 *   2. Si el operador no tiene saldo para pagar un win → el round se VOIDEA
 *      (HouseInsufficientForWinError, isOperatorHouse=true); rollback atómico
 *      (saldo del player restaurado, sin round persistido). Sin respaldo de la
 *      Casa. [service-level con rng forzado a un win]
 *   3. Jugador tenant-wide (sin independiente arriba) → lo banca la Casa, como
 *      siempre (no-regresión).
 *   4. Rollback de un round bancado por un independiente → revierte contra la
 *      wallet del operador, no la Casa. [service-level]
 */

import { eq, sql } from 'drizzle-orm';
import { gameSessions, HOUSE_USERNAME, type GameSession } from '@casino/db';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { TEST_TENANT } from '../setup/test-tenant';
import { GameRoundsService } from '../../games/game-rounds.service';
import { HouseInsufficientForWinError } from '../../house/house.errors';

describe('Juego bancado por sucursal independiente (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let rounds: GameRoundsService;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    rounds = ctx.app.get(GameRoundsService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.tenantDb.execute(sql`DELETE FROM game_rounds`);
    await ctx.tenantDb.execute(sql`DELETE FROM game_sessions`);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  async function makeUser(
    label: string,
    role: string,
  ): Promise<{ id: string; username: string; password: string; token: string }> {
    const u = await createTestUser(ctx.request, adminToken, {
      suite: 'indep-house',
      label,
      role,
    });
    const token = await loginAs(ctx.request, u.username, u.password);
    return { ...u, token };
  }

  async function setParent(childId: string, parentId: string): Promise<void> {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType: 'subordinado' });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`setParent falló: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function makeIndependent(socioId: string): Promise<void> {
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${socioId}`,
    );
  }

  async function getBalance(userId: string): Promise<number> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    );
    const rows = r as unknown as Array<{ balance: string }>;
    return Number(rows[0]?.balance ?? 0);
  }

  async function getCasaBalance(): Promise<number> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT w.balance FROM wallets w
          JOIN users u ON u.id = w.user_id
          WHERE u.username = ${HOUSE_USERNAME} LIMIT 1`,
    );
    const rows = r as unknown as Array<{ balance: string }>;
    return Number(rows[0]?.balance ?? 0);
  }

  async function getCasaUserId(): Promise<string> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${HOUSE_USERNAME} LIMIT 1`,
    );
    const rows = r as unknown as Array<{ id: string }>;
    return rows[0]!.id;
  }

  /** wallet_id que tomó el bet de un round (tx game_house_bet). */
  async function getHouseBetWalletUserId(): Promise<string | null> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT w.user_id FROM wallet_transactions wt
          JOIN wallets w ON w.id = wt.wallet_id
          WHERE wt.source = 'game_house_bet'
          ORDER BY wt.created_at DESC LIMIT 1`,
    );
    const rows = r as unknown as Array<{ user_id: string }>;
    return rows[0]?.user_id ?? null;
  }

  async function launch(token: string): Promise<string> {
    const res = await ctx.request
      .post('/tenant/games/code/mock_lucky_seven/launch')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
    expect(res.status).toBe(201);
    return res.body.sessionId as string;
  }

  async function loadSession(sessionId: string): Promise<GameSession> {
    const rows = await ctx.tenantDb
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .limit(1);
    return rows[0]!;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 1. Jugador bajo independiente → lo banca el operador; Casa intacta.
  // ──────────────────────────────────────────────────────────────────────

  it('bet de jugador bajo independiente → banca el operador, la Casa NO se mueve', async () => {
    const socio = await makeUser('t1_socio', 'socio');
    await makeIndependent(socio.id);
    const player = await makeUser('t1_player', 'usuario_final');
    await setParent(player.id, socio.id);

    await fundWalletForTests(socio.id, '100000'); // bankroll del operador
    await fundWalletForTests(player.id, '1000');

    const casaBefore = await getCasaBalance();
    const socioBefore = await getBalance(socio.id);
    const playerBefore = await getBalance(player.id);

    const sessionId = await launch(player.token);
    const res = await ctx.request
      .post(`/tenant/games/sessions/${sessionId}/bet`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', player.token)
      .send({ amount: '100' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('settled');

    const casaAfter = await getCasaBalance();
    const socioAfter = await getBalance(socio.id);
    const playerAfter = await getBalance(player.id);

    // La Casa del tenant NO se involucra en el juego del independiente.
    expect(casaAfter).toBeCloseTo(casaBefore, 2);
    // El operador es la contraparte: su delta = -(delta del jugador).
    expect(socioAfter - socioBefore).toBeCloseTo(-(playerAfter - playerBefore), 2);
    // Conservación dentro de la sub-economía operador+jugador.
    expect(socioAfter + playerAfter).toBeCloseTo(socioBefore + playerBefore, 2);
    // La pata de la casa quedó en la wallet del operador, no en la Casa.
    expect(await getHouseBetWalletUserId()).toBe(socio.id);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. Operador sin saldo para el win → round VOIDEADO (sin respaldo de Casa).
  // ──────────────────────────────────────────────────────────────────────

  it('operador sin saldo para pagar el win → voidea el round (banca su propio riesgo)', async () => {
    const socio = await makeUser('t2_socio', 'socio');
    await makeIndependent(socio.id);
    const player = await makeUser('t2_player', 'usuario_final');
    await setParent(player.id, socio.id);

    // Operador en CERO (no compró fichas / sin bankroll). Player fondeado.
    await fundWalletForTests(player.id, '500');

    const casaBefore = await getCasaBalance();
    const sessionId = await launch(player.token);
    const session = await loadSession(sessionId);

    // rng=()=>0 fuerza un win (1.5x): el operador toma el bet (50) pero el win
    // (75) supera su saldo → InsufficientBalance → HouseInsufficientForWinError.
    await expect(
      rounds.placeBetAndSettle(ctx.tenantDb, {
        session,
        actorUserId: player.id,
        betAmount: '50',
        rng: () => 0,
      }),
    ).rejects.toMatchObject({
      name: 'HouseInsufficientForWinError',
      isOperatorHouse: true,
    });

    // Rollback atómico: nada cambió.
    expect(await getBalance(player.id)).toBeCloseTo(500, 2);
    expect(await getBalance(socio.id)).toBeCloseTo(0, 2);
    expect(await getCasaBalance()).toBeCloseTo(casaBefore, 2);
    // No quedó round persistido para esa sesión.
    const persisted = await ctx.tenantDb.execute(
      sql`SELECT count(*)::int AS n FROM game_rounds WHERE session_id = ${sessionId}`,
    );
    expect((persisted as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. Jugador tenant-wide → lo banca la Casa (no-regresión).
  // ──────────────────────────────────────────────────────────────────────

  it('bet de jugador SIN independiente arriba → lo banca la Casa', async () => {
    const player = await makeUser('t3_player', 'usuario_final');
    await fundWalletForTests(player.id, '1000');

    const casaUserId = await getCasaUserId();
    const casaBefore = await getCasaBalance();
    const playerBefore = await getBalance(player.id);

    const sessionId = await launch(player.token);
    const res = await ctx.request
      .post(`/tenant/games/sessions/${sessionId}/bet`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', player.token)
      .send({ amount: '100' });
    expect(res.status).toBe(200);

    const casaAfter = await getCasaBalance();
    const playerAfter = await getBalance(player.id);

    // La Casa es la contraparte: su delta = -(delta del jugador). Conservación.
    expect(casaAfter - casaBefore).toBeCloseTo(-(playerAfter - playerBefore), 2);
    expect(casaAfter + playerAfter).toBeCloseTo(casaBefore + playerBefore, 2);
    // La pata de la casa quedó en la Casa.
    expect(await getHouseBetWalletUserId()).toBe(casaUserId);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. Rollback de un round del independiente → revierte contra el operador.
  // ──────────────────────────────────────────────────────────────────────

  it('rollback de un round bancado por el independiente → revierte su wallet, no la Casa', async () => {
    const socio = await makeUser('t4_socio', 'socio');
    await makeIndependent(socio.id);
    const player = await makeUser('t4_player', 'usuario_final');
    await setParent(player.id, socio.id);

    await fundWalletForTests(socio.id, '1000');
    await fundWalletForTests(player.id, '500');

    const casaBefore = await getCasaBalance();
    const sessionId = await launch(player.token);
    const session = await loadSession(sessionId);

    // rng=()=>0.99 fuerza una PÉRDIDA (no hay win): bet 100 → player 400,
    // operador 1100. Round settled, net -100.
    const round = await rounds.placeBetAndSettle(ctx.tenantDb, {
      session,
      actorUserId: player.id,
      betAmount: '100',
      rng: () => 0.99,
    });
    expect(round.status).toBe('settled');
    expect(await getBalance(player.id)).toBeCloseTo(400, 2);
    expect(await getBalance(socio.id)).toBeCloseTo(1100, 2);

    // Rollback → todo vuelve; la reversa golpea al operador, no la Casa.
    const rolled = await rounds.rollbackRound(ctx.tenantDb, {
      roundId: round.id,
      actorUserId: socio.id,
      reason: 'test rollback independiente',
    });
    expect(rolled.status).toBe('rolled_back');
    expect(await getBalance(player.id)).toBeCloseTo(500, 2);
    expect(await getBalance(socio.id)).toBeCloseTo(1000, 2);
    expect(await getCasaBalance()).toBeCloseTo(casaBefore, 2);
  });
});
