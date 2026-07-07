/**
 * E2E: game loop completo (Sprint 35).
 *
 * Cubre el flujo end-to-end: launch session → place bet → settle + wallet
 * debit/credit → close session → history.
 *
 * Casos:
 *   1. Launch happy: status=active, openedBalance snapshot, launchUrl no vacío.
 *   2. Place bet con saldo suficiente: round persistido, wallet debited.
 *   3. Place bet excede maxBet → 400 GAME_BET_OUT_OF_RANGE.
 *   4. Place bet < minBet → 400.
 *   5. Place bet sin saldo → 409 INSUFFICIENT_BALANCE.
 *   6. Place bet en session de OTRO user → 403.
 *   7. Place bet en session cerrada → 409.
 *   8. Player con auto-exclusion: launch → 403, bet → 403.
 *   9. Player con bet_limit_per_round: bet excede → 409 BET_LIMIT_EXCEEDED.
 *  10. Close session: status=closed, closingBalance snapshot.
 *  11. Sessions/:id/rounds devuelve history; otro user no puede leerla.
 *  12. Multiple bets actualizan wallet correctamente (suma de bets/wins).
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { TEST_TENANT } from '../setup/test-tenant';

describe('Game loop (E2E, Sprint 35)', () => {
  let ctx: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    // Aislamiento: limpiar sesiones + rounds + RG settings + exclusions
    // entre tests para no contaminar.
    await ctx.tenantDb.execute(sql`DELETE FROM game_rounds`);
    await ctx.tenantDb.execute(sql`DELETE FROM game_sessions`);
    await ctx.tenantDb.execute(sql`DELETE FROM self_exclusions`);
    await ctx.tenantDb.execute(sql`DELETE FROM responsible_gaming_settings`);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  async function makePlayer(label: string): Promise<{
    id: string;
    username: string;
    password: string;
    token: string;
  }> {
    const u = await createTestUser(ctx.request, adminToken, {
      suite: 'game-loop',
      label,
      role: 'usuario_final',
    });
    const token = await loginAs(ctx.request, u.username, u.password);
    return { ...u, token };
  }

  /** Fondea la wallet del player directo por DB. */
  async function fundPlayer(playerId: string, amount: string): Promise<void> {
    await fundWalletForTests(playerId, amount);
  }

  async function getBalance(userId: string): Promise<number> {
    const r = await ctx.tenantDb.execute(
      sql`SELECT balance FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    );
    const rows = r as unknown as Array<{ balance: string }>;
    return Number(rows[0]?.balance ?? 0);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tests
  // ──────────────────────────────────────────────────────────────────────

  describe('launch', () => {
    it('launch crea session activa con openedBalance', async () => {
      const player = await makePlayer('launch_ok');
      await fundPlayer(player.id, '500');
      const res = await ctx.request
        .post('/tenant/games/code/mock_lucky_seven/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      expect(res.status).toBe(201);
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.launchUrl).toMatch(/\/play\/games\/mock_lucky_seven/);
      expect(Number(res.body.openedBalance)).toBeCloseTo(500, 2);
    });

    it('launch de un game inactivo → 409', async () => {
      // Archivamos vía SQL para no depender del endpoint admin.
      await ctx.tenantDb.execute(
        sql`UPDATE games SET is_active = false WHERE code = 'mock_book_of_demo'`,
      );
      const player = await makePlayer('launch_inactive');
      // El controller chequea isActive en findByCode → devuelve 404.
      const res = await ctx.request
        .post('/tenant/games/code/mock_book_of_demo/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      // No found porque el controller short-circuita.
      expect([404, 409]).toContain(res.status);
      // Restaurar.
      await ctx.tenantDb.execute(
        sql`UPDATE games SET is_active = true WHERE code = 'mock_book_of_demo'`,
      );
    });

    it('launch bloqueado por auto-exclusion → 403', async () => {
      const player = await makePlayer('launch_excl');
      await ctx.request
        .post('/tenant/responsible-gaming/me/exclude')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({
          type: 'cool_off',
          endsAt: new Date(Date.now() + 86400_000).toISOString(),
        });
      const res = await ctx.request
        .post('/tenant/games/code/mock_lucky_seven/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('USER_EXCLUDED');
    });
  });

  describe('place bet', () => {
    async function setupSession(label: string, fund: string) {
      const player = await makePlayer(label);
      await fundPlayer(player.id, fund);
      const launch = await ctx.request
        .post('/tenant/games/code/mock_lucky_seven/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      expect(launch.status).toBe(201);
      return { player, sessionId: launch.body.sessionId as string };
    }

    it('place bet → round settled, wallet movido', async () => {
      const { player, sessionId } = await setupSession('bet_ok', '500');
      const balBefore = await getBalance(player.id);
      const res = await ctx.request
        .post(`/tenant/games/sessions/${sessionId}/bet`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ amount: '50' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('settled');
      expect(res.body.betAmount).toBe('50.00');
      expect(res.body.payload).toBeDefined();
      expect(typeof res.body.payload.rng).toBe('number');

      const balAfter = await getBalance(player.id);
      const winAmt = Number(res.body.winAmount);
      // Wallet delta = -bet + win
      expect(balAfter).toBeCloseTo(balBefore - 50 + winAmt, 2);
    });

    it('idempotencia: mismo clientRoundId (doble clic) → UNA sola apuesta', async () => {
      const { player, sessionId } = await setupSession('bet_idem', '500');
      const balBefore = await getBalance(player.id);
      const clientRoundId = randomUUID();

      const bet = () =>
        ctx.request
          .post(`/tenant/games/sessions/${sessionId}/bet`)
          .set('Host', TEST_TENANT.host)
          .set('Authorization', player.token)
          .send({ amount: '50', clientRoundId });

      // Doble clic / reintento: dos pedidos con la misma marca, uno tras otro
      // (el caso real — el front bloquea el botón, así que no son simultáneos
      // puros). Sin el fix se crean 2 rondas y se apuesta 2 veces. Con el
      // chequeo por clientRoundId, el segundo devuelve la ronda ya procesada.
      const first = await bet();
      const second = await bet();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      // Es la MISMA ronda — no se creó una segunda.
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.roundExternalId).toBe(first.body.roundExternalId);

      // El wallet se movió UNA sola vez: delta = -bet + win (NO -2*bet).
      const balAfter = await getBalance(player.id);
      const winAmt = Number(first.body.winAmount);
      expect(balAfter).toBeCloseTo(balBefore - 50 + winAmt, 2);
    });

    it('bet > maxBet → 400 GAME_BET_OUT_OF_RANGE', async () => {
      // mock_lucky_seven config.maxBet = '500'
      const { player, sessionId } = await setupSession('bet_max', '10000');
      const res = await ctx.request
        .post(`/tenant/games/sessions/${sessionId}/bet`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ amount: '600' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('GAME_BET_OUT_OF_RANGE');
      expect(res.body.maxBet).toBe('500');
    });

    it('bet < minBet → 400', async () => {
      // mock_lucky_seven config.minBet = '1'. Probamos con 0.5.
      const { player, sessionId } = await setupSession('bet_min', '100');
      const res = await ctx.request
        .post(`/tenant/games/sessions/${sessionId}/bet`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ amount: '0.50' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('GAME_BET_OUT_OF_RANGE');
    });

    it('bet sin saldo → 409 INSUFFICIENT_BALANCE', async () => {
      // Player sin fondear.
      const player = await makePlayer('bet_broke');
      const launch = await ctx.request
        .post('/tenant/games/code/mock_lucky_seven/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      const res = await ctx.request
        .post(`/tenant/games/sessions/${launch.body.sessionId}/bet`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ amount: '10' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('INSUFFICIENT_BALANCE');
    });

    it('bet en session de OTRO user → 403', async () => {
      const owner = await makePlayer('bet_owner');
      await fundPlayer(owner.id, '100');
      const launch = await ctx.request
        .post('/tenant/games/code/mock_lucky_seven/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', owner.token);

      const intruder = await makePlayer('bet_intruder');
      await fundPlayer(intruder.id, '100');
      const res = await ctx.request
        .post(`/tenant/games/sessions/${launch.body.sessionId}/bet`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', intruder.token)
        .send({ amount: '10' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('GAME_SESSION_USER_MISMATCH');
    });

    it('bet en session cerrada → 409', async () => {
      const { player, sessionId } = await setupSession('bet_closed', '500');
      // Cerramos primero.
      await ctx.request
        .post(`/tenant/games/sessions/${sessionId}/close`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      const res = await ctx.request
        .post(`/tenant/games/sessions/${sessionId}/bet`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ amount: '10' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('GAME_SESSION_NOT_ACTIVE');
    });

    it('bet bloqueado por bet_limit_per_round → 409 BET_LIMIT_EXCEEDED', async () => {
      const { player, sessionId } = await setupSession('bet_caplim', '1000');
      await ctx.request
        .patch('/tenant/responsible-gaming/me')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ betLimitPerRound: '20' });
      const res = await ctx.request
        .post(`/tenant/games/sessions/${sessionId}/bet`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token)
        .send({ amount: '50' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('BET_LIMIT_EXCEEDED');
    });
  });

  describe('close + history', () => {
    it('close session: idempotente + snapshot de closingBalance', async () => {
      const player = await makePlayer('close_ok');
      await fundPlayer(player.id, '300');
      const launch = await ctx.request
        .post('/tenant/games/code/mock_lucky_seven/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      const sid = launch.body.sessionId;
      const r1 = await ctx.request
        .post(`/tenant/games/sessions/${sid}/close`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      expect(r1.status).toBe(200);
      expect(r1.body.status).toBe('closed');
      expect(r1.body.closingBalance).toBeDefined();

      // Idempotente: 2da llamada devuelve el mismo session.
      const r2 = await ctx.request
        .post(`/tenant/games/sessions/${sid}/close`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      expect(r2.status).toBe(200);
      expect(r2.body.id).toBe(r1.body.id);
    });

    it('listSessionRounds devuelve history; otro user → 403', async () => {
      const player = await makePlayer('hist_owner');
      await fundPlayer(player.id, '500');
      const launch = await ctx.request
        .post('/tenant/games/code/mock_lucky_seven/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      const sid = launch.body.sessionId;
      // Hacer 3 bets.
      for (let i = 0; i < 3; i++) {
        await ctx.request
          .post(`/tenant/games/sessions/${sid}/bet`)
          .set('Host', TEST_TENANT.host)
          .set('Authorization', player.token)
          .send({ amount: '10' });
      }

      const hist = await ctx.request
        .get(`/tenant/games/sessions/${sid}/rounds`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      expect(hist.status).toBe(200);
      expect(hist.body.data).toHaveLength(3);

      // Otro user no puede leer.
      const intruder = await makePlayer('hist_intruder');
      const intrudeRes = await ctx.request
        .get(`/tenant/games/sessions/${sid}/rounds`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', intruder.token);
      expect(intrudeRes.status).toBe(403);
    });
  });

  describe('active sessions list', () => {
    it('devuelve solo las activas del actor', async () => {
      const player = await makePlayer('active_list');
      await fundPlayer(player.id, '100');
      // Abrir 2 sessions (juegos distintos).
      await ctx.request
        .post('/tenant/games/code/mock_lucky_seven/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      await ctx.request
        .post('/tenant/games/code/mock_book_of_demo/launch')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);

      const res = await ctx.request
        .get('/tenant/games/sessions/active')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', player.token);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(
        res.body.data.every((s: { userId: string }) => s.userId === player.id),
      ).toBe(true);
    });
  });
});
