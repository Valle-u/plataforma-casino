/**
 * E2E: subsistema de leagues / leaderboards.
 *
 * Cobertura:
 *
 * CRUD admin:
 *   - create con periodo daily/weekly/etc + metric.
 *   - code conflict 409.
 *   - sin permiso 403.
 *   - schedule inválido (endsAt <= startsAt) → 409.
 *
 * Recompute (bet_volume):
 *   - 3 users con bets diferentes en la ventana → standings ordenadas
 *     por bet_volume DESC, posiciones 1/2/3 correctas.
 *   - bet fuera de la ventana NO entra.
 *   - rounds_count metric: count(*) de bets, no sum(amount).
 *   - metric no soportada → 409.
 *
 * Standings view:
 *   - top N + posición del user logueado.
 *   - User fuera del top N → array `around` con ventana.
 *   - User sin participation → solo top.
 *
 * Close & settle:
 *   - Premio a posición 1, 2-3, 4-5.
 *   - Verifica wallet del top 1 sube por chips amount.
 *   - league_results creados, status='closed'.
 *   - Re-run idempotent.
 *   - close sobre league ya closed → 0 settled, no error.
 *
 * Admin endpoints:
 *   - POST /jobs/close-due procesa todas las vencidas.
 *   - sin leagues.run_actions → 403.
 *
 * Tests insertan wallet_tx bet sintéticos (igual que cashback) para
 * tener activity sin engine de juegos.
 */

import postgres from 'postgres';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { getTestTenantUrl } from '../setup/db-helpers';

function freshKey(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getWalletId(userId: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM wallets WHERE user_id = ${userId}
    `;
    return rows[0]!.id;
  } finally {
    await sql.end();
  }
}

async function ensureWallet(ctx: TestApp, token: string): Promise<void> {
  const r = await ctx.request
    .get('/tenant/wallet/me')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token);
  expect(r.status).toBe(200);
}

async function insertBet(walletId: string, amount: string, createdAt: Date): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const idemKey = `synthetic-bet-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await sql.unsafe(
      `INSERT INTO wallet_transactions
        (id, wallet_id, type, amount, balance_after, source, idempotency_key, created_at)
       VALUES
        (gen_random_uuid(), $1, 'bet', $2, 0, 'synthetic_test', $3, $4)`,
      [walletId, amount, idemKey, createdAt.toISOString()],
    );
  } finally {
    await sql.end();
  }
}

async function readWalletBalance(userId: string): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ balance: string }[]>`
      SELECT balance FROM wallets WHERE user_id = ${userId}
    `;
    return rows[0]?.balance ?? '0';
  } finally {
    await sql.end();
  }
}

async function readLeague(id: string): Promise<Record<string, unknown> | null> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<Record<string, unknown>[]>`
      SELECT * FROM leagues WHERE id = ${id}
    `;
    return rows[0] ?? null;
  } finally {
    await sql.end();
  }
}

async function setEndsAtPast(leagueId: string, daysAgo = 1): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql.unsafe(
      `UPDATE leagues SET ends_at = NOW() - ($1::int * INTERVAL '1 day'), starts_at = NOW() - ($1::int + 1) * INTERVAL '1 day' WHERE id = $2`,
      [daysAgo, leagueId],
    );
  } finally {
    await sql.end();
  }
}

describe('Leagues / Rankings (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let cajero1Token: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    await ctx.request
      .post('/tenant/wallet/mint')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .set('Idempotency-Key', freshKey('mint-leagues'))
      .send({ amount: '1000000', reason: 'mint inicial para fondear leagues en tests' });

    cajero1Token = await loginAsCajero1(ctx.request);
  });

  afterAll(async () => {
    await ctx.close();
  });

  /**
   * Crea una league con startsAt = NOW. Esto aísla cada test de bets
   * insertadas por tests previos (que tienen createdAt < NOW del setup
   * de este test). El test debe insertar sus bets DESPUÉS de la creación
   * de la league (al menos 1ms después) — `new Date()` entre llamadas
   * ya cumple eso.
   *
   * endsAt 7 días en el futuro (no vence durante el test).
   */
  async function createLeague(overrides?: {
    code?: string;
    metric?: string;
    prizes?: Record<string, unknown>;
    startsAt?: string;
    endsAt?: string;
    period?: string;
  }): Promise<{ id: string; code: string }> {
    const code = overrides?.code ?? `league_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const startsAt = overrides?.startsAt ?? new Date().toISOString();
    const endsAt = overrides?.endsAt ?? new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    const res = await ctx.request
      .post('/tenant/leagues')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code,
        name: `League ${code}`,
        period: overrides?.period ?? 'weekly',
        metric: overrides?.metric ?? 'bet_volume',
        prizes: overrides?.prizes ?? {},
        startsAt,
        endsAt,
      });
    expect(res.status).toBe(201);
    return { id: res.body.id as string, code };
  }

  // ──────────────────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────────────────

  describe('CRUD admin', () => {
    it('admin crea league → 201', async () => {
      const { id } = await createLeague();
      expect(id).toBeDefined();
    });

    it('code duplicado → 409', async () => {
      const code = `dup_league_${Date.now()}`;
      await createLeague({ code });
      const second = await ctx.request
        .post('/tenant/leagues')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code,
          name: 'Dup',
          period: 'weekly',
          metric: 'bet_volume',
          startsAt: new Date(Date.now() - 1000).toISOString(),
          endsAt: new Date(Date.now() + 1000_000).toISOString(),
        });
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ error: 'LEAGUE_CODE_CONFLICT' });
    });

    it('cajero1 sin leagues.create_definition → 403', async () => {
      const res = await ctx.request
        .post('/tenant/leagues')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token)
        .send({
          code: `c_${Date.now()}`,
          name: 'X',
          period: 'daily',
          metric: 'bet_volume',
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 1000_000).toISOString(),
        });
      expect(res.status).toBe(403);
    });

    it('schedule inválido (endsAt <= startsAt) → 409', async () => {
      const now = new Date().toISOString();
      const res = await ctx.request
        .post('/tenant/leagues')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `bad_${Date.now()}`,
          name: 'Bad',
          period: 'daily',
          metric: 'bet_volume',
          startsAt: now,
          endsAt: now, // mismo timestamp
        });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'LEAGUE_SCHEDULE_INVALID' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Recompute
  // ──────────────────────────────────────────────────────────────────────

  describe('Recompute bet_volume', () => {
    it('3 users con bets distintos → posiciones 1/2/3 correctas', async () => {
      const { id } = await createLeague({ metric: 'bet_volume' });

      // Crear 3 players con activity en la ventana.
      const players: Array<{ id: string; volume: string }> = [];
      for (const volume of ['100', '300', '200']) {
        const player = await createTestUser(ctx.request, adminToken, {
          suite: `league-bv-${volume}`,
          label: 'p',
          role: 'usuario_final',
        });
        const token = await loginAs(ctx.request, player.username, player.password);
        await ensureWallet(ctx, token);
        const walletId = await getWalletId(player.id);
        await insertBet(walletId, volume, new Date());
        players.push({ id: player.id, volume });
      }

      const recompute = await ctx.request
        .post(`/tenant/leagues/${id}/recompute`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(recompute.status).toBe(200);
      expect(recompute.body.participants).toBeGreaterThanOrEqual(3);

      // Standings: el de 300 debe ser #1 dentro del top.
      const standings = await ctx.request
        .get(`/tenant/leagues/${id}/standings?topN=10`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(standings.status).toBe(200);

      const top = standings.body.top as Array<{
        userId: string;
        score: string;
        position: number;
      }>;
      const myPlayers = top.filter((t) => players.some((p) => p.id === t.userId));
      expect(myPlayers).toHaveLength(3);
      const sorted = [...myPlayers].sort((a, b) => a.position - b.position);
      // El de 300 está más arriba que el de 200, que está más arriba que el de 100.
      expect(sorted[0]!.userId).toBe(players[1]!.id); // volume 300
      expect(sorted[1]!.userId).toBe(players[2]!.id); // volume 200
      expect(sorted[2]!.userId).toBe(players[0]!.id); // volume 100
    });

    it('bet fuera de la ventana NO entra al cálculo', async () => {
      const startsAt = new Date(Date.now() - 1000).toISOString();
      const endsAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      const { id } = await createLeague({ startsAt, endsAt });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'league-outside',
        label: 'p',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, player.username, player.password);
      await ensureWallet(ctx, token);
      const walletId = await getWalletId(player.id);

      // Bet ANTES de startsAt.
      await insertBet(walletId, '99999', new Date(Date.now() - 24 * 3600_000));

      await ctx.request
        .post(`/tenant/leagues/${id}/recompute`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const standings = await ctx.request
        .get(`/tenant/leagues/${id}/standings`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const top = standings.body.top as Array<{ userId: string }>;
      // El player NO debe aparecer en top.
      expect(top.find((t) => t.userId === player.id)).toBeUndefined();
    });

    it('metric=rounds_count cuenta filas, no suma amount', async () => {
      const { id } = await createLeague({ metric: 'rounds_count' });

      const playerA = await createTestUser(ctx.request, adminToken, {
        suite: 'league-rc-A',
        label: 'p',
        role: 'usuario_final',
      });
      const playerB = await createTestUser(ctx.request, adminToken, {
        suite: 'league-rc-B',
        label: 'p',
        role: 'usuario_final',
      });
      const tA = await loginAs(ctx.request, playerA.username, playerA.password);
      const tB = await loginAs(ctx.request, playerB.username, playerB.password);
      await ensureWallet(ctx, tA);
      await ensureWallet(ctx, tB);
      const wA = await getWalletId(playerA.id);
      const wB = await getWalletId(playerB.id);

      // A: 5 bets de monto bajo. B: 1 bet de monto alto.
      for (let i = 0; i < 5; i += 1) {
        await insertBet(wA, '10', new Date());
      }
      await insertBet(wB, '10000', new Date());

      await ctx.request
        .post(`/tenant/leagues/${id}/recompute`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const standings = await ctx.request
        .get(`/tenant/leagues/${id}/standings`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const top = standings.body.top as Array<{
        userId: string;
        position: number;
        score: string;
      }>;
      const a = top.find((t) => t.userId === playerA.id);
      const b = top.find((t) => t.userId === playerB.id);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      // A tiene 5 rounds, B tiene 1 → A va más arriba.
      expect(a!.position).toBeLessThan(b!.position);
      // Postgres numeric(20, 4) devuelve scores con 4 decimales fijos
      // ("5.0000"). Comparamos numéricamente.
      expect(Number(a!.score)).toBe(5);
      expect(Number(b!.score)).toBe(1);
    });

    it('metric no soportada (gross_won) → 409 al recompute', async () => {
      const { id } = await createLeague({ metric: 'gross_won' });
      const res = await ctx.request
        .post(`/tenant/leagues/${id}/recompute`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'LEAGUE_METRIC_NOT_SUPPORTED' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Standings view
  // ──────────────────────────────────────────────────────────────────────

  describe('Standings view', () => {
    it('user fuera del topN → array `around` con ventana', async () => {
      const { id } = await createLeague({ metric: 'bet_volume' });

      // Crear top 3 con bets altos.
      for (const volume of ['1000', '900', '800']) {
        const p = await createTestUser(ctx.request, adminToken, {
          suite: `league-around-top-${volume}`,
          label: 'p',
          role: 'usuario_final',
        });
        const t = await loginAs(ctx.request, p.username, p.password);
        await ensureWallet(ctx, t);
        const w = await getWalletId(p.id);
        await insertBet(w, volume, new Date());
      }

      // Player con bet bajo (posición 4).
      const lowPlayer = await createTestUser(ctx.request, adminToken, {
        suite: 'league-around-low',
        label: 'p',
        role: 'usuario_final',
      });
      const lowToken = await loginAs(ctx.request, lowPlayer.username, lowPlayer.password);
      await ensureWallet(ctx, lowToken);
      const lowWallet = await getWalletId(lowPlayer.id);
      await insertBet(lowWallet, '1', new Date());

      await ctx.request
        .post(`/tenant/leagues/${id}/recompute`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const standings = await ctx.request
        .get(`/tenant/leagues/${id}/standings?topN=2`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', lowToken);
      expect(standings.status).toBe(200);
      // Top tiene 2 entries.
      expect(standings.body.top).toHaveLength(2);
      // around debe existir y contener al lowPlayer.
      expect(standings.body.around).toBeDefined();
      const aroundUserIds = (standings.body.around as Array<{ userId: string }>).map(
        (a) => a.userId,
      );
      expect(aroundUserIds).toContain(lowPlayer.id);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Close & settle
  // ──────────────────────────────────────────────────────────────────────

  describe('Close & settle', () => {
    it('close otorga premios a posiciones premiadas + status=closed', async () => {
      const { id } = await createLeague({
        metric: 'bet_volume',
        prizes: {
          '1': { kind: 'chips', amount: 500 },
          '2-3': { kind: 'chips', amount: 100 },
        },
      });

      // 4 players: bets 400/300/200/100.
      const players = [];
      for (const volume of ['400', '300', '200', '100']) {
        const p = await createTestUser(ctx.request, adminToken, {
          suite: `league-settle-${volume}`,
          label: 'p',
          role: 'usuario_final',
        });
        const t = await loginAs(ctx.request, p.username, p.password);
        await ensureWallet(ctx, t);
        const w = await getWalletId(p.id);
        await insertBet(w, volume, new Date());
        players.push({ ...p, volume });
      }

      const balanceBeforeP1 = await readWalletBalance(players[0]!.id);
      const balanceBeforeP4 = await readWalletBalance(players[3]!.id);

      const close = await ctx.request
        .post(`/tenant/leagues/${id}/close`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(close.status).toBe(200);
      expect(close.body.totalSettled).toBeGreaterThanOrEqual(3); // pos 1, 2, 3

      // P1 (volume 400, position 1) recibió 500.
      const balanceAfterP1 = await readWalletBalance(players[0]!.id);
      expect(Number(balanceAfterP1) - Number(balanceBeforeP1)).toBe(500);

      // P4 (position 4) NO recibió premio (no hay key "4" en prizes).
      const balanceAfterP4 = await readWalletBalance(players[3]!.id);
      expect(balanceAfterP4).toBe(balanceBeforeP4);

      // League ahora cerrada.
      const dbLeague = await readLeague(id);
      expect(dbLeague!.status).toBe('closed');

      // Results endpoint devuelve 3 entries.
      const results = await ctx.request
        .get(`/tenant/leagues/${id}/results`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(results.status).toBe(200);
      expect((results.body.data as unknown[]).length).toBeGreaterThanOrEqual(3);
    });

    it('close idempotent: segundo close → 0 settled', async () => {
      const { id } = await createLeague({
        metric: 'bet_volume',
        prizes: { '1': { kind: 'chips', amount: 50 } },
      });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'league-idem-close',
        label: 'p',
        role: 'usuario_final',
      });
      const t = await loginAs(ctx.request, player.username, player.password);
      await ensureWallet(ctx, t);
      const w = await getWalletId(player.id);
      await insertBet(w, '100', new Date());

      const r1 = await ctx.request
        .post(`/tenant/leagues/${id}/close`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(r1.body.totalSettled).toBeGreaterThanOrEqual(1);

      const r2 = await ctx.request
        .post(`/tenant/leagues/${id}/close`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      // League ya está closed → totalSettled = 0 (early return).
      expect(r2.body.totalSettled).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Cron job endpoint
  // ──────────────────────────────────────────────────────────────────────

  describe('jobs/close-due endpoint', () => {
    it('procesa todas las leagues vencidas', async () => {
      const { id } = await createLeague({
        metric: 'bet_volume',
        prizes: { '1': { kind: 'chips', amount: 25 } },
      });

      const player = await createTestUser(ctx.request, adminToken, {
        suite: 'league-cron',
        label: 'p',
        role: 'usuario_final',
      });
      const t = await loginAs(ctx.request, player.username, player.password);
      await ensureWallet(ctx, t);
      const w = await getWalletId(player.id);
      await insertBet(w, '50', new Date());

      // Forzar endsAt al pasado.
      await setEndsAtPast(id);

      const res = await ctx.request
        .post('/tenant/leagues/jobs/close-due')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThanOrEqual(1);

      const dbLeague = await readLeague(id);
      expect(dbLeague!.status).toBe('closed');
    });

    it('cajero1 sin leagues.run_actions → 403', async () => {
      const res = await ctx.request
        .post('/tenant/leagues/jobs/close-due')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajero1Token);
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Antifraude integration (doc 15 §C6: cuentas duplicadas excluidas)
  // ──────────────────────────────────────────────────────────────────────

  describe('Antifraude integration', () => {
    /**
     * Helper: crea un link fraud entre 2 users directamente vía SQL
     * (sin pasar por el scan completo). Más rápido y deterministico que
     * setup full con sessions sintéticas.
     */
    async function insertFraudLink(
      userA: string,
      userB: string,
      score: number,
      status: 'suspected' | 'confirmed' | 'dismissed' = 'suspected',
    ): Promise<void> {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
      try {
        await sql.unsafe(
          `INSERT INTO fraud_account_links
            (id, user_a_id, user_b_id, score, signals, status)
           VALUES
            (gen_random_uuid(), $1, $2, $3, '[]'::jsonb, $4)
           ON CONFLICT (user_a_id, user_b_id)
           DO UPDATE SET score = EXCLUDED.score, status = EXCLUDED.status,
                         last_updated_at = NOW()`,
          [a, b, score, status],
        );
      } finally {
        await sql.end();
      }
    }

    async function deleteAllFraudLinks(): Promise<void> {
      const sql = postgres(getTestTenantUrl(), { max: 1 });
      try {
        await sql.unsafe(`DELETE FROM fraud_account_links`);
      } finally {
        await sql.end();
      }
    }

    it('recompute excluye users en links suspected con score >= 70', async () => {
      const { id } = await createLeague({ metric: 'bet_volume' });

      // 3 players, todos con bets dentro de la ventana.
      const players: string[] = [];
      for (const volume of ['1000', '500', '200']) {
        const p = await createTestUser(ctx.request, adminToken, {
          suite: `fraud-league-${volume}`,
          label: 'p',
          role: 'usuario_final',
        });
        const token = await loginAs(ctx.request, p.username, p.password);
        await ensureWallet(ctx, token);
        const w = await getWalletId(p.id);
        await insertBet(w, volume, new Date());
        players.push(p.id);
      }

      // Flageamos a player[0] (volume=1000) via fraud link con player[1].
      await deleteAllFraudLinks();
      await insertFraudLink(players[0]!, players[1]!, 85, 'suspected');

      await ctx.request
        .post(`/tenant/leagues/${id}/recompute`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const standings = await ctx.request
        .get(`/tenant/leagues/${id}/standings?topN=10`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const top = standings.body.top as Array<{ userId: string; position: number }>;

      // Players 0 y 1 (ambos flagged) NO deben aparecer.
      expect(top.find((t) => t.userId === players[0])).toBeUndefined();
      expect(top.find((t) => t.userId === players[1])).toBeUndefined();
      // Player 2 (no flagged) SÍ aparece.
      expect(top.find((t) => t.userId === players[2])).toBeDefined();

      await deleteAllFraudLinks();
    });

    it('link dismissed NO excluye al user', async () => {
      const { id } = await createLeague({ metric: 'bet_volume' });

      const p = await createTestUser(ctx.request, adminToken, {
        suite: 'fraud-league-dismissed',
        label: 'p',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, p.username, p.password);
      await ensureWallet(ctx, token);
      const w = await getWalletId(p.id);
      await insertBet(w, '100', new Date());

      // Crear un user phantom para el otro lado del link y marcar
      // dismissed.
      const phantom = await createTestUser(ctx.request, adminToken, {
        suite: 'fraud-league-phantom',
        label: 'p',
        role: 'usuario_final',
      });
      await deleteAllFraudLinks();
      await insertFraudLink(p.id, phantom.id, 90, 'dismissed');

      await ctx.request
        .post(`/tenant/leagues/${id}/recompute`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const standings = await ctx.request
        .get(`/tenant/leagues/${id}/standings`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const top = standings.body.top as Array<{ userId: string }>;
      expect(top.find((t) => t.userId === p.id)).toBeDefined();

      await deleteAllFraudLinks();
    });

    it('link confirmed SÍ excluye al user', async () => {
      const { id } = await createLeague({ metric: 'bet_volume' });

      const p = await createTestUser(ctx.request, adminToken, {
        suite: 'fraud-league-confirmed',
        label: 'p',
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, p.username, p.password);
      await ensureWallet(ctx, token);
      const w = await getWalletId(p.id);
      await insertBet(w, '100', new Date());

      const phantom = await createTestUser(ctx.request, adminToken, {
        suite: 'fraud-league-confirmed-phantom',
        label: 'p',
        role: 'usuario_final',
      });
      await deleteAllFraudLinks();
      await insertFraudLink(p.id, phantom.id, 90, 'confirmed');

      await ctx.request
        .post(`/tenant/leagues/${id}/recompute`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);

      const standings = await ctx.request
        .get(`/tenant/leagues/${id}/standings`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      const top = standings.body.top as Array<{ userId: string }>;
      expect(top.find((t) => t.userId === p.id)).toBeUndefined();

      await deleteAllFraudLinks();
    });
  });
});
