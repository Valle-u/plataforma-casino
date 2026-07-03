/**
 * E2E: invariantes del gameplay tras el refactor mint/burn puro.
 *
 * Modelo actual (post-refactor):
 *   - `bet`  = burn puro sobre el wallet del jugador
 *              (`executeTransaction(type='bet', direction='debit',
 *               source='game_bet')`, `counterpartyUserId=null`,
 *               `relatedTxId=null`). No mueve la Casa ni al operador
 *               independiente arriba en la jerarquía.
 *   - `win`  = mint puro sobre el wallet del jugador
 *              (`executeTransaction(type='win', direction='credit',
 *               source='game_win')`, `counterpartyUserId=null`). NUNCA
 *               falla por bankroll: se emiten fichas al vuelo.
 *   - rollback = única wallet_tx neta sobre el jugador
 *                (`executeGameRollback`, source='game_rollback',
 *                 direction=inverso al net del round). No toca Casa ni
 *                 operador.
 *
 * Este suite reemplaza al viejo "juego bancado por indep / casa" que
 * asumía transfer doble entrada player↔casa por cada bet/win (semántica
 * retirada). Cobertura nueva:
 *
 *   1. Player bajo independiente → bet/win solo mueven al player;
 *      Casa y operador indep quedan INTACTOS. Conservación fuerte:
 *      el delta del player es el ÚNICO cash flow del round.
 *   2. Player tenant-wide (sin indep arriba) → mismo invariante:
 *      Casa intacta. La wallet Casa NO es contraparte en el gameplay.
 *   3. Operador indep en CERO no impide un win: `win = mint puro`,
 *      el round settlea igual y el player cobra. El operador indep
 *      queda intacto (no se le drena bankroll). No existe error
 *      `HOUSE_INSUFFICIENT_FOR_WIN`.
 *   4. Rollback de un round settled → única wallet_tx neta sobre el
 *      player, `source='game_rollback'`, sin pata a la Casa ni al
 *      operador. Idempotente.
 *   5. `wallet_transactions` del bet y del win tienen
 *      `counterpartyUserId=null`, `relatedTxId=null` y las sources
 *      correctas (`game_bet` / `game_win`). Confirma la forma del
 *      mint/burn puro a nivel de row.
 */

import { eq, sql } from 'drizzle-orm';
import { gameSessions, HOUSE_USERNAME, type GameSession } from '@casino/db';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { TEST_TENANT } from '../setup/test-tenant';
import { GameRoundsService } from '../../games/game-rounds.service';

describe('Gameplay mint/burn puro (E2E)', () => {
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
      suite: 'mint-burn',
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

  /**
   * Devuelve las wallet_transactions del round (bet, win, rollback).
   * Filtra por las sources del nuevo modelo mint/burn. Ordenadas por
   * created_at asc para que el bet venga antes que el win.
   */
  async function getRoundTxs(
    roundExternalId: string,
  ): Promise<
    Array<{
      type: string;
      source: string;
      amount: string;
      counterparty_user_id: string | null;
      related_tx_id: string | null;
    }>
  > {
    // NOTA: `wallet_transactions` NO tiene columna `direction` en el
    // schema — la dirección se INFIERE del `type` (helper directionFor:
    // 'bet' → debit, 'win' → credit, etc.). No la seleccionamos aquí.
    const r = await ctx.tenantDb.execute(
      sql`SELECT type, source, amount,
                 counterparty_user_id, related_tx_id
            FROM wallet_transactions
            WHERE reference_id = ${roundExternalId}
              AND source IN ('game_bet', 'game_win', 'game_rollback')
            ORDER BY created_at ASC`,
    );
    return r as unknown as Array<{
      type: string;
      source: string;
      amount: string;
      counterparty_user_id: string | null;
      related_tx_id: string | null;
    }>;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 1. Player bajo independiente → bet/win no mueven al operador.
  // ──────────────────────────────────────────────────────────────────────

  it('bet + win: bajo indep, Casa y operador quedan INTACTOS (mint/burn puro)', async () => {
    const socio = await makeUser('t1_socio', 'socio');
    await makeIndependent(socio.id);
    const player = await makeUser('t1_player', 'usuario_final');
    await setParent(player.id, socio.id);

    // El operador tiene bankroll (que NO debe tocarse) y el player fondos.
    await fundWalletForTests(socio.id, '100000');
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

    // Invariante nuevo: la Casa NO se toca en gameplay.
    expect(casaAfter).toBeCloseTo(casaBefore, 2);
    // Invariante nuevo: el operador indep NO se toca en gameplay
    //   (el bet no descuenta bankroll ni el win lo drena — hay burn/mint puro).
    expect(socioAfter).toBeCloseTo(socioBefore, 2);
    // El player es el ÚNICO wallet que cambia por el round: delta = -bet + win.
    const winAmt = Number(res.body.winAmount);
    expect(playerAfter - playerBefore).toBeCloseTo(-100 + winAmt, 2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. Player tenant-wide → Casa intacta (no-regresión).
  // ──────────────────────────────────────────────────────────────────────

  it('bet + win: tenant-wide, la Casa tampoco se mueve', async () => {
    const player = await makeUser('t2_player', 'usuario_final');
    await fundWalletForTests(player.id, '1000');

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

    // La Casa YA NO es contraparte del round (era el modelo viejo).
    expect(casaAfter).toBeCloseTo(casaBefore, 2);
    // El player es el único que cambia. Delta = -bet + win.
    const winAmt = Number(res.body.winAmount);
    expect(playerAfter - playerBefore).toBeCloseTo(-100 + winAmt, 2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. Operador indep en cero: el win SIEMPRE paga (mint no falla).
  // ──────────────────────────────────────────────────────────────────────

  it('operador indep en CERO: rng forzado a win → settlea igual, mint no falla', async () => {
    const socio = await makeUser('t3_socio', 'socio');
    await makeIndependent(socio.id);
    const player = await makeUser('t3_player', 'usuario_final');
    await setParent(player.id, socio.id);

    // Operador en cero: en el modelo viejo esto tumbaba el round con
    // HOUSE_INSUFFICIENT_FOR_WIN. En el nuevo modelo el win es mint puro
    // — no depende del bankroll del operador.
    await fundWalletForTests(player.id, '500');

    const casaBefore = await getCasaBalance();
    const sessionId = await launch(player.token);
    const session = await loadSession(sessionId);

    // rng=()=>0 fuerza un win 1.5x (bet 50 → win 75, net +25).
    const round = await rounds.placeBetAndSettle(ctx.tenantDb, {
      session,
      actorUserId: player.id,
      betAmount: '50',
      rng: () => 0,
    });
    expect(round.status).toBe('settled');
    // El player cobra: balance = 500 - 50 + 75 = 525.
    expect(await getBalance(player.id)).toBeCloseTo(525, 2);
    // El operador indep en cero sigue en cero — el win no lo drenó.
    expect(await getBalance(socio.id)).toBeCloseTo(0, 2);
    // La Casa tampoco fue respaldo — sigue igual.
    expect(await getCasaBalance()).toBeCloseTo(casaBefore, 2);

    // Sanity: el round quedó persistido con winWalletTxId no-nulo.
    expect(round.winWalletTxId).not.toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. Rollback: única wallet_tx neta sobre el player, sin pata a Casa/indep.
  // ──────────────────────────────────────────────────────────────────────

  it('rollback de round settled: neteo sobre el player, Casa e indep intactos', async () => {
    const socio = await makeUser('t4_socio', 'socio');
    await makeIndependent(socio.id);
    const player = await makeUser('t4_player', 'usuario_final');
    await setParent(player.id, socio.id);

    await fundWalletForTests(socio.id, '1000');
    await fundWalletForTests(player.id, '500');

    const casaBefore = await getCasaBalance();
    const socioBefore = await getBalance(socio.id);
    const sessionId = await launch(player.token);
    const session = await loadSession(sessionId);

    // rng=()=>0.99 fuerza PÉRDIDA: bet 100 sin win → player 400, net -100.
    const round = await rounds.placeBetAndSettle(ctx.tenantDb, {
      session,
      actorUserId: player.id,
      betAmount: '100',
      rng: () => 0.99,
    });
    expect(round.status).toBe('settled');
    expect(await getBalance(player.id)).toBeCloseTo(400, 2);
    // Ni operador ni Casa se movieron por el bet.
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore, 2);
    expect(await getCasaBalance()).toBeCloseTo(casaBefore, 2);

    // Rollback → net inverso: refund +100 al player. Sin pata en la Casa
    // ni en el operador (mint/burn puro también en el rollback).
    const rolled = await rounds.rollbackRound(ctx.tenantDb, {
      roundId: round.id,
      actorUserId: socio.id,
      reason: 'test rollback mint/burn puro',
    });
    expect(rolled.status).toBe('rolled_back');
    expect(await getBalance(player.id)).toBeCloseTo(500, 2);
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore, 2);
    expect(await getCasaBalance()).toBeCloseTo(casaBefore, 2);

    // Idempotencia: 2do rollback no cambia balances ni cash flow.
    const rolled2 = await rounds.rollbackRound(ctx.tenantDb, {
      roundId: round.id,
      actorUserId: socio.id,
      reason: 'test rollback mint/burn puro (retry)',
    });
    expect(rolled2.status).toBe('rolled_back');
    expect(await getBalance(player.id)).toBeCloseTo(500, 2);
    expect(await getBalance(socio.id)).toBeCloseTo(socioBefore, 2);
    expect(await getCasaBalance()).toBeCloseTo(casaBefore, 2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. Forma de la row: mint/burn puro tiene counterparty y related NULL.
  // ──────────────────────────────────────────────────────────────────────

  it('wallet_transactions del bet y del win: counterpartyUserId + relatedTxId son NULL', async () => {
    const player = await makeUser('t5_player', 'usuario_final');
    await fundWalletForTests(player.id, '500');

    const sessionId = await launch(player.token);
    const session = await loadSession(sessionId);

    // rng=()=>0 fuerza win, así verificamos las 2 rows (bet + win).
    const round = await rounds.placeBetAndSettle(ctx.tenantDb, {
      session,
      actorUserId: player.id,
      betAmount: '50',
      rng: () => 0,
    });
    expect(round.status).toBe('settled');

    const txs = await getRoundTxs(round.roundExternalId);
    // Sanity: se emitieron exactamente 2 txs (bet + win).
    expect(txs).toHaveLength(2);

    const bet = txs.find((t) => t.source === 'game_bet');
    const win = txs.find((t) => t.source === 'game_win');
    expect(bet).toBeDefined();
    expect(win).toBeDefined();

    // Bet = burn puro.
    expect(bet!.type).toBe('bet');
    // La direction se infiere del type via directionFor() en el service;
    // 'bet' es debit. Alcanza con validar el type.
    expect(bet!.type).toBe('bet');
    expect(bet!.counterparty_user_id).toBeNull();
    expect(bet!.related_tx_id).toBeNull();

    // Win = mint puro.
    expect(win!.type).toBe('win');
    // 'win' es credit via directionFor.
    expect(win!.type).toBe('win');
    expect(win!.counterparty_user_id).toBeNull();
    expect(win!.related_tx_id).toBeNull();
  });

  it('wallet_transactions del rollback: única row neta sobre el player, sin contraparte', async () => {
    const player = await makeUser('t6_player', 'usuario_final');
    await fundWalletForTests(player.id, '500');

    const sessionId = await launch(player.token);
    const session = await loadSession(sessionId);

    // rng=()=>0.99 fuerza pérdida: bet 100, sin win. net = -100.
    const round = await rounds.placeBetAndSettle(ctx.tenantDb, {
      session,
      actorUserId: player.id,
      betAmount: '100',
      rng: () => 0.99,
    });
    expect(round.status).toBe('settled');

    await rounds.rollbackRound(ctx.tenantDb, {
      roundId: round.id,
      actorUserId: player.id,
      reason: 'test rollback shape',
    });

    const txs = await getRoundTxs(round.roundExternalId);
    // bet + rollback (no hubo win porque perdió).
    const rollback = txs.find((t) => t.source === 'game_rollback');
    expect(rollback).toBeDefined();
    // Rollback de una pérdida = credit al player por el bet.
    // El rollback usa type='win' (con source='game_rollback') para que
    // directionFor lo trate como credit — refunder al player un net
    // negativo. Ver comentario en wallet.service.ts::executeGameRollback.
    expect(rollback!.type).toBe('win');
    expect(rollback!.type).toBe('win'); // executeGameRollback usa type='win' cuando direction='credit'
    expect(Number(rollback!.amount)).toBeCloseTo(100, 2);
    expect(rollback!.counterparty_user_id).toBeNull();
    expect(rollback!.related_tx_id).toBeNull();
  });
});
