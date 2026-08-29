/**
 * E2E: WalletStatsService — auditoría de netwin por ámbito.
 *
 * Verifica que cada KPI salga de su FUENTE AUTORITATIVA (la lección del bug de
 * netwin y de bonos):
 *   1. netwinFor lee game_rounds (solo `settled`, por settled_at, por scope).
 *   2. scopedAudit.plata (depósitos/retiros) y .fichas (cargas/descargas
 *      operador vs jugador) leen wallet_transactions por type + clase de owner.
 *   3. scopedAudit.bonos lee user_bonuses (NO los types de wallet, que no se
 *      crean) — otorgados/liberados/perdidos.
 *   4. getCentralNetworkIds excluye a los socios dependientes y sus sub-redes.
 *   5. getAdminNetworkIds excluye las sub-redes independientes (aislamiento).
 *
 * Los datos se insertan DIRECTO en DB para controlar montos/estados/fechas.
 * Cada test usa users propios y scopea las queries a ellos → sin necesidad de
 * truncar entre tests.
 */

import { sql } from 'drizzle-orm';
import { loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';
import { WalletStatsService } from '../../wallet-stats/wallet-stats.service';
import { UserHierarchyService } from '../../user-hierarchy/user-hierarchy.service';

type Row = { id: string };
const rows = (r: unknown): Row[] => r as unknown as Row[];

describe('WalletStatsService — auditoría netwin por ámbito (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;
  let stats: WalletStatsService;
  let hierarchy: UserHierarchyService;
  let gameSession: { gameId: string; sessionId: string } | null = null;
  let bonusDefId: string | null = null;
  let seq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    const aRow = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username} LIMIT 1`,
    );
    adminId = rows(aRow)[0]!.id;
    stats = ctx.app.get(WalletStatsService);
    hierarchy = ctx.app.get(UserHierarchyService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  async function mkUser(label: string, role: string) {
    return createTestUser(ctx.request, adminToken, {
      suite: 'wstats-audit',
      label,
      role,
    });
  }

  async function setParent(childId: string, parentId: string): Promise<void> {
    const r = await ctx.request
      .put(`/tenant/user-hierarchy/${childId}/parent`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ parentUserId: parentId, relationType: 'asignado_manual' });
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`setParent falló: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  async function ensureGameSession(): Promise<{ gameId: string; sessionId: string }> {
    if (gameSession) return gameSession;
    await ctx.tenantDb.execute(
      sql`INSERT INTO games (id, code, name, category)
          VALUES (gen_random_uuid(), 'wstats_test_game', 'WStats Test', 'slots')
          ON CONFLICT (code) DO NOTHING`,
    );
    const g = await ctx.tenantDb.execute(
      sql`SELECT id FROM games WHERE code = 'wstats_test_game' LIMIT 1`,
    );
    const gameId = rows(g)[0]!.id;
    const s = await ctx.tenantDb.execute(
      sql`INSERT INTO game_sessions (id, user_id, game_id, provider_session_id)
          VALUES (gen_random_uuid(), ${adminId}, ${gameId}, 'wstats-test-sess')
          RETURNING id`,
    );
    gameSession = { gameId, sessionId: rows(s)[0]!.id };
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
    const iso = when.toISOString();
    const settledAt = status === 'settled' ? iso : null;
    await ctx.tenantDb.execute(
      sql`INSERT INTO game_rounds
            (id, session_id, user_id, game_id, round_external_id,
             bet_amount, win_amount, net_amount, status, placed_at, settled_at)
          VALUES
            (gen_random_uuid(), ${sessionId}, ${userId}, ${gameId}, ${`ws-${seq++}`},
             ${bet.toFixed(2)}, ${win.toFixed(2)}, ${net}, ${status}, ${iso}, ${settledAt})`,
    );
  }

  async function insertTx(
    userId: string,
    type: string,
    amount: number,
  ): Promise<void> {
    await ctx.tenantDb.execute(
      sql`INSERT INTO wallets (id, user_id, balance)
          VALUES (gen_random_uuid(), ${userId}, '0')
          ON CONFLICT (user_id) DO NOTHING`,
    );
    const w = await ctx.tenantDb.execute(
      sql`SELECT id FROM wallets WHERE user_id = ${userId} LIMIT 1`,
    );
    const walletId = rows(w)[0]!.id;
    await ctx.tenantDb.execute(
      sql`INSERT INTO wallet_transactions
            (id, wallet_id, type, amount, balance_after, source, created_at)
          VALUES
            (gen_random_uuid(), ${walletId}, ${type}, ${amount.toFixed(2)},
             ${amount.toFixed(2)}, 'test', now())`,
    );
  }

  async function setBalance(userId: string, balance: number): Promise<void> {
    await ctx.tenantDb.execute(
      sql`INSERT INTO wallets (id, user_id, balance)
          VALUES (gen_random_uuid(), ${userId}, ${balance.toFixed(2)})
          ON CONFLICT (user_id) DO UPDATE SET balance = ${balance.toFixed(2)}`,
    );
  }

  async function ensureBonusDef(): Promise<string> {
    if (bonusDefId) return bonusDefId;
    await ctx.tenantDb.execute(
      sql`INSERT INTO bonus_definitions
            (id, code, name, type, funded_by_user_id, created_by_user_id)
          VALUES
            (gen_random_uuid(), 'wstats_test_bonus', 'WStats Bonus', 'manual',
             ${adminId}, ${adminId})
          ON CONFLICT (code, created_by_user_id) DO NOTHING`,
    );
    const d = await ctx.tenantDb.execute(
      sql`SELECT id FROM bonus_definitions
          WHERE code = 'wstats_test_bonus' AND created_by_user_id = ${adminId} LIMIT 1`,
    );
    bonusDefId = rows(d)[0]!.id;
    return bonusDefId;
  }

  async function insertBonus(
    userId: string,
    opts: {
      granted: number;
      remaining: number;
      status: string;
      grantedAt: Date;
      clearedAt?: Date;
      updatedAt?: Date;
    },
  ): Promise<void> {
    const defId = await ensureBonusDef();
    const expiresAt = new Date('2027-01-01T00:00:00Z').toISOString();
    await ctx.tenantDb.execute(
      sql`INSERT INTO user_bonuses
            (id, user_id, definition_id, granted_amount, remaining_amount, status,
             funded_by_user_id, grant_idempotency_key, expires_at, granted_at,
             cleared_at, updated_at)
          VALUES
            (gen_random_uuid(), ${userId}, ${defId}, ${opts.granted.toFixed(2)},
             ${opts.remaining.toFixed(2)}, ${opts.status}, ${adminId},
             ${`ws-bonus-${seq++}`}, ${expiresAt}, ${opts.grantedAt.toISOString()},
             ${opts.clearedAt ? opts.clearedAt.toISOString() : null},
             ${(opts.updatedAt ?? opts.grantedAt).toISOString()})`,
    );
  }

  // ── Tests ──────────────────────────────────────────────────────────────

  it('netwinFor: solo cuenta rounds settled (excluye placed/rolled_back)', async () => {
    const p = await mkUser('nw1', 'usuario_final');
    const when = new Date('2026-08-10T12:00:00Z');
    await insertRound(p.id, 1000, 600, 'settled', when); // netwin +400
    await insertRound(p.id, 500, 0, 'placed', when); // excluido
    await insertRound(p.id, 200, 0, 'rolled_back', when); // excluido

    const nw = await stats.netwinFor(ctx.tenantDb, { restrictToUserIds: [p.id] });

    expect(Number(nw.apostado)).toBe(1000);
    expect(Number(nw.ganado)).toBe(600);
    expect(Number(nw.netwin)).toBe(400);
    expect(Number(nw.rtp)).toBeCloseTo(0.6, 4);
  });

  it('netwinFor: filtra por settled_at dentro del rango', async () => {
    const p = await mkUser('nw2', 'usuario_final');
    await insertRound(p.id, 100, 50, 'settled', new Date('2026-07-20T00:00:00Z'));
    await insertRound(p.id, 300, 100, 'settled', new Date('2026-08-05T00:00:00Z'));

    const aug = await stats.netwinFor(ctx.tenantDb, {
      restrictToUserIds: [p.id],
      dateFrom: new Date('2026-08-01T00:00:00Z'),
      dateTo: new Date('2026-08-31T23:59:59Z'),
    });

    expect(Number(aug.apostado)).toBe(300); // solo la ronda de agosto
    expect(Number(aug.ganado)).toBe(100);
    expect(Number(aug.netwin)).toBe(200);
  });

  it('netwinFor: respeta restrictToUserIds (aísla por ámbito)', async () => {
    const p1 = await mkUser('nw3a', 'usuario_final');
    const p2 = await mkUser('nw3b', 'usuario_final');
    await insertRound(p1.id, 100, 50, 'settled', new Date('2026-08-10T00:00:00Z'));
    await insertRound(p2.id, 999, 0, 'settled', new Date('2026-08-10T00:00:00Z'));

    const nw = await stats.netwinFor(ctx.tenantDb, { restrictToUserIds: [p1.id] });
    expect(Number(nw.apostado)).toBe(100); // p2 no cuenta
  });

  it('scopedAudit: plata (dep/ret) y fichas (operador vs jugador)', async () => {
    const socio = await mkUser('au_socio', 'socio');
    const player = await mkUser('au_player', 'usuario_final');
    await setParent(player.id, socio.id);

    await insertTx(socio.id, 'load', 5000); // operador → cargasOperadores
    await insertTx(socio.id, 'unload', 1000); // operador → descargas
    await insertTx(player.id, 'load', 300); // jugador → cargasJugadores
    await insertTx(player.id, 'deposit', 800);
    await insertTx(player.id, 'withdrawal', 200);

    const audit = await stats.scopedAudit(ctx.tenantDb, {
      restrictToUserIds: [socio.id, player.id],
    });

    expect(Number(audit.plata.depositos)).toBe(800);
    expect(Number(audit.plata.retiros)).toBe(200);
    expect(Number(audit.plata.neto)).toBe(600);
    expect(Number(audit.fichas.cargasOperadores)).toBe(5000);
    expect(Number(audit.fichas.descargasOperadores)).toBe(1000);
    expect(Number(audit.fichas.cargasJugadores)).toBe(300);
  });

  it('scopedAudit: bonos salen de user_bonuses, NO de los types de wallet', async () => {
    const p = await mkUser('bo1', 'usuario_final');
    const aug1 = new Date('2026-08-01T00:00:00Z');
    const aug5 = new Date('2026-08-05T00:00:00Z');
    const aug11 = new Date('2026-08-11T00:00:00Z');
    const aug12 = new Date('2026-08-12T00:00:00Z');

    await insertBonus(p.id, { granted: 1000, remaining: 1000, status: 'active', grantedAt: aug11 });
    await insertBonus(p.id, { granted: 500, remaining: 500, status: 'cleared', grantedAt: aug5, clearedAt: aug11 });
    await insertBonus(p.id, { granted: 300, remaining: 300, status: 'expired', grantedAt: aug1, updatedAt: aug12 });
    // 'cancelled' NO cuenta como perdido (el fondeo vuelve al que fondeó).
    await insertBonus(p.id, { granted: 700, remaining: 700, status: 'cancelled', grantedAt: aug5, updatedAt: aug12 });

    // Trampa: un wallet_tx type='bonus_grant' con monto absurdo NO debe contarse.
    await insertTx(p.id, 'bonus_grant', 99999);

    const audit = await stats.scopedAudit(ctx.tenantDb, { restrictToUserIds: [p.id] });

    // otorgados = todos los grants (por granted_at): 1000+500+300+700 = 2500.
    expect(Number(audit.bonos.otorgados)).toBe(2500);
    // liberados = remaining de los 'cleared': 500.
    expect(Number(audit.bonos.liberados)).toBe(500);
    // perdidos = remaining de expired/forfeited (no cancelled): 300.
    expect(Number(audit.bonos.perdidos)).toBe(300);
  });

  it('circulación: Σ balance de jugadores puros (excluye operadores)', async () => {
    const socio = await mkUser('ci_socio', 'socio');
    const player = await mkUser('ci_player', 'usuario_final');
    await setBalance(socio.id, 9999); // operador → NO cuenta
    await setBalance(player.id, 1234); // jugador → cuenta

    const audit = await stats.scopedAudit(ctx.tenantDb, {
      restrictToUserIds: [socio.id, player.id],
    });
    expect(Number(audit.circulacion)).toBe(1234);
  });

  it('getCentralNetworkIds: excluye a los socios dependientes y su sub-red', async () => {
    const socio = await mkUser('ce_socio', 'socio');
    const socioPlayer = await mkUser('ce_sp', 'usuario_final');
    const cajero = await mkUser('ce_caj', 'cajero');
    const directPlayer = await mkUser('ce_dp', 'usuario_final');
    await setParent(socio.id, adminId);
    await setParent(socioPlayer.id, socio.id);
    await setParent(cajero.id, adminId);
    await setParent(directPlayer.id, cajero.id);

    const central = await hierarchy.getCentralNetworkIds(ctx.tenantDb);

    expect(central.has(cajero.id)).toBe(true); // cajero directo del admin
    expect(central.has(directPlayer.id)).toBe(true); // su jugador
    expect(central.has(socio.id)).toBe(false); // socio dependiente excluido
    expect(central.has(socioPlayer.id)).toBe(false); // y su sub-red
  });

  it('getAdminNetworkIds: excluye la sub-red de un socio independiente', async () => {
    const indep = await mkUser('is_socio', 'socio');
    const indepPlayer = await mkUser('is_player', 'usuario_final');
    await setParent(indepPlayer.id, indep.id);
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${indep.id}`,
    );

    const adminNet = await hierarchy.getAdminNetworkIds(ctx.tenantDb);
    expect(adminNet.has(indep.id)).toBe(false);
    expect(adminNet.has(indepPlayer.id)).toBe(false);
  });
  it('listMovements: una apuesta trae el contexto de la ronda que la originó', async () => {
    // Sin esto la pantalla mostraba "Apuesta · Juego" y nada más: no se sabía
    // de qué juego, de qué ronda, ni si esos pesos eran un giro común o la
    // compra de una tanda de tiradas gratis.
    const player = await mkUser('ctx_player', 'usuario_final');
    const { gameId, sessionId } = await ensureGameSession();

    await ctx.tenantDb.execute(
      sql`INSERT INTO wallets (id, user_id, balance)
           VALUES (gen_random_uuid(), ${player.id}, '0')
           ON CONFLICT (user_id) DO NOTHING`,
    );
    const w = await ctx.tenantDb.execute(
      sql`SELECT id FROM wallets WHERE user_id = ${player.id} LIMIT 1`,
    );
    const walletId = rows(w)[0]!.id;

    // La apuesta, y la ronda que la explica.
    const tx = await ctx.tenantDb.execute(
      sql`INSERT INTO wallet_transactions
             (id, wallet_id, type, amount, balance_after, source, created_at)
           VALUES
             (gen_random_uuid(), ${walletId}, 'bet', '5000.00', '0.00',
              'gregmorn_callback', now())
           RETURNING id`,
    );
    const txId = rows(tx)[0]!.id;

    await ctx.tenantDb.execute(
      sql`INSERT INTO game_rounds
             (id, session_id, user_id, game_id, round_external_id,
              bet_amount, win_amount, net_amount, status, action,
              bet_wallet_tx_id, placed_at, settled_at)
           VALUES
             (gen_random_uuid(), ${sessionId}, ${player.id}, ${gameId},
              'round-ctx-1', '5000.00', '827.50', '-4172.50', 'settled',
              'bonus_buy', ${txId}, now(), now())`,
    );

    const page = await stats.listMovements(ctx.tenantDb, {
      restrictToUserIds: [player.id],
      limit: 50,
      offset: 0,
    });

    const mov = page.data.find((m) => m.id === txId);
    expect(mov).toBeDefined();
    expect(mov!.gameName).toBe('WStats Test');
    expect(mov!.roundExternalId).toBe('round-ctx-1');
    expect(mov!.roundAction).toBe('bonus_buy');
    // Totales de la RONDA entera: es lo que explica un premio sin apuesta.
    expect(Number(mov!.roundBet)).toBeCloseTo(5000, 2);
    expect(Number(mov!.roundWin)).toBeCloseTo(827.5, 2);
  });
});
