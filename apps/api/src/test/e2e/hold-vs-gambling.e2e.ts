/**
 * E2E (regresión): el dinero en hold (retiro pendiente) NO es apostable
 * y NO se reporta como jugable al proveedor.
 *
 * Pregunta del dueño: "el dinero en hold para los usuarios, ¿es simbólico
 * o realmente no se puede usar en los juegos? Quiero que sea así: si el
 * saldo está en hold, que se descuente de lo que puede apostar, y que
 * directamente no aparezca el saldo en los juegos."
 *
 * Diseño (docs/05 §7, LEYES E6): al solicitar un retiro, `wallet_holds`
 * incrementa `wallets.locked_balance`. Esas fichas NO son gastables
 * mientras el retiro espera aprobación.
 *
 * HISTORIA: antes del fix (2026-08-02) el hold bloqueaba el gasto solo por
 * el CHECK SQL `locked_balance <= balance` (defensa de la DB), no por
 * validación explícita: el placeBet moría con DrizzleQueryError (500), el
 * palace balance reportaba el locked como jugable, y el palace bet daba
 * result 99 en vez de check 31. El fix hizo que `executeTransaction` y
 * `placeBetWithBonus` validen contra `balance - locked_balance`
 * (InsufficientBalanceError → 409 / check 31) y que `totalBalance` reste
 * el locked del saldo reportado al proveedor.
 *
 * EXPECTATIVA (pos-fix):
 *   1. placeBet (juego interno) — apostar más que lo disponible lanza
 *      InsufficientBalanceError y deja la wallet intacta.
 *   2. Palace balance — con 100 en hold (disponible=0) el proveedor recibe
 *      balance=0: el saldo en hold NO aparece en los juegos.
 *   3. Palace bet — apostar plata en hold responde check 31
 *      (insufficient balance).
 */

import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { fundWalletForTests } from '../helpers/fund-wallet';
import { WalletService } from '../../wallet/wallet.service';
import { getControlUrl, getTestTenantUrl } from '../setup/db-helpers';
import { TEST_TENANT } from '../setup/test-tenant';

const CALLBACK_TOKEN = 'test-hold-callback-token';
const PALACE_ACCOUNT = 'u_hold_diag';
const PALACE_ROUTE = '/api/v1/game-provider/palace/callback';
const CHECK_INSUFFICIENT_BALANCE = 31;

interface WalletState {
  balance: string;
  lockedBalance: string;
}

async function readWalletState(userId: string): Promise<WalletState> {
  const sqlc = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sqlc<{ balance: string; locked_balance: string }[]>`
      SELECT balance, locked_balance
      FROM wallets
      WHERE user_id = ${userId}
    `;
    const row = rows[0];
    if (!row) throw new Error('Wallet no encontrada');
    return { balance: row.balance, lockedBalance: row.locked_balance };
  } finally {
    await sqlc.end();
  }
}

async function createPaymentMethod(code: string): Promise<string> {
  const sqlc = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sqlc<{ id: string }[]>`
      INSERT INTO payment_methods (id, code, name, type, config, is_active)
      VALUES (gen_random_uuid(), ${code}, ${code + ' display'}, 'bank_transfer', '{"cbu":"0000000000000000000000"}'::jsonb, true)
      RETURNING id
    `;
    return rows[0]!.id;
  } finally {
    await sqlc.end();
  }
}

/**
 * Crea el jugador Palace con una wallet: balance 100, de los cuales 100
 * están en hold (retiro pendiente). Disponible real = 0.
 * El hold real vive en `wallet_holds` y está respaldado por txs (invariante
 * balance == Σtx, locked == Σ holds activos).
 */
async function seedPalacePlayerWithHold(): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const sqlc = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const u = await sqlc<{ id: string }[]>`
      INSERT INTO users (id, username, display_name, password_hash, status, palace_account, palace_user_code)
      VALUES (gen_random_uuid(), ${'hold_diag_' + suffix}, 'Hold Diag', 'test-no-login', 'active', ${PALACE_ACCOUNT}, 2002)
      RETURNING id
    `;
    const userId = u[0]!.id;

    const w = await sqlc<{ id: string }[]>`
      INSERT INTO wallets (id, user_id, balance, bonus_balance, locked_balance)
      VALUES (gen_random_uuid(), ${userId}, '100.00', '0.00', '100.00')
      RETURNING id
    `;
    const walletId = w[0]!.id;

    // Invariante `balance == Σtx`: mint de 100.
    await sqlc`
      INSERT INTO wallet_transactions
        (id, wallet_id, type, amount, balance_after, source, reason, idempotency_key)
      VALUES
        (gen_random_uuid(), ${walletId}, 'mint', '100.00', '100.00', 'test_funding', 'fondeo de test', ${'e2e-hold-fund-' + suffix})
    `;

    // Invariante `locked == Σ holds activos`: hold real de 100.
    await sqlc`
      INSERT INTO wallet_holds (id, wallet_id, amount, reason, related_entity_type, related_entity_id)
      VALUES (gen_random_uuid(), ${walletId}, '100.00', 'withdrawal:diag-test', 'withdrawal', gen_random_uuid())
    `;

    return userId;
  } finally {
    await sqlc.end();
  }
}

/** Pega un callback a Palace con el token del tenant. */
function palaceRequest(request: TestApp['request'], body: Record<string, unknown>) {
  return request.post(PALACE_ROUTE).set('Callback-Token', CALLBACK_TOKEN).send(body);
}

describe('DIAGNÓSTICO: hold (retiro pendiente) vs apuestas (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let methodId: string;
  let palacePlayerId: string;

  beforeAll(async () => {
    // Token de Palace en control DB ANTES del bootstrap (precarga en cache).
    const control = postgres(getControlUrl(), { max: 1 });
    try {
      await control`
        UPDATE tenants SET palace_callback_token = ${CALLBACK_TOKEN}
        WHERE slug = ${TEST_TENANT.slug}
      `;
    } finally {
      await control.end();
    }

    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    methodId = await createPaymentMethod(`hold-method-${Date.now().toString(36)}`);
    palacePlayerId = await seedPalacePlayerWithHold();
  });

  afterAll(async () => {
    const control = postgres(getControlUrl(), { max: 1 });
    try {
      await control`
        UPDATE tenants SET palace_callback_token = NULL
        WHERE slug = ${TEST_TENANT.slug}
      `;
    } finally {
      await control.end();
    }
    await ctx.close();
  });

  // ──────────────────────────────────────────────────────────────────
  // Escenario 1: placeBet (game loop interno) — WalletService directo.
  // ──────────────────────────────────────────────────────────────────

  it('placeBet: apostar más que lo disponible (hold) NO debería completarse', async () => {
    // Jugador con $100, retira $80 → locked=80, disponible=20.
    const user = await createTestUser(ctx.request, adminToken, {
      suite: 'hold-diag-1',
      label: 'p1',
      role: 'usuario_final',
    });
    await fundWalletForTests(user.id, '100');
    const token = await loginAs(ctx.request, user.username, user.password);

    const w = await ctx.request
      .post('/tenant/withdrawals')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token)
      .send({
        methodId,
        amountChips: '80',
        amountFiat: '800',
        currencyFiat: 'ARS',
        targetAccount: { cbu: '0' },
      });
    expect(w.status).toBe(201);

    const before = await readWalletState(user.id);
    console.log('[hold-diag] wallet tras retiro:', before);

    const walletService = ctx.app.get(WalletService);
    const walletRows = (await ctx.tenantDb.execute(
      sql`SELECT id FROM wallets WHERE user_id = ${user.id} LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    const walletId = walletRows[0]!.id;

    // Bet de $50 — SUPERIOR a los $20 disponibles (los otros $80 están en hold).
    let outcome: string;
    try {
      await walletService.placeBet(ctx.tenantDb, {
        walletId,
        amount: '50',
        sessionId: '00000000-0000-7000-8000-000000000001',
        roundExternalId: '00000000-0000-7000-8000-000000000001',
        actorUserId: user.id,
      });
      outcome = 'COMPLETADO (bet exitoso)';
    } catch (err) {
      outcome = `${(err as Error).constructor.name}: ${(err as Error).message}`;
    }
    console.log('[hold-diag] placeBet 50 con disponible=20 →', outcome);

    const after = await readWalletState(user.id);
    console.log('[hold-diag] wallet tras placeBet:', after);

    // Pos-fix: executeTransaction valida contra `balance - locked_balance`
    // (LEYES E6). El bet de $50 supera los $20 disponibles → rechazo
    // explícito con InsufficientBalanceError (409), no el DrizzleQueryError
    // (500) que producía el CHECK SQL. La wallet queda intacta (100/80).
    expect(outcome).not.toBe('COMPLETADO (bet exitoso)');
    expect(outcome).toContain('InsufficientBalanceError');
    expect(after.balance).toBe('100.00');
    expect(after.lockedBalance).toBe('80.00');
  });

  // ──────────────────────────────────────────────────────────────────
  // Escenario 2: Palace Casino (seamless wallet).
  // ──────────────────────────────────────────────────────────────────

  it('palace balance: el proveedor ve como jugable el dinero en hold', async () => {
    const res = await palaceRequest(ctx.request, {
      command: 'balance',
      data: { account: PALACE_ACCOUNT },
      check: '21,22',
    });

    const wallet = await readWalletState(palacePlayerId);
    console.log('[hold-diag] palace balance → status:', res.status, 'body:', JSON.stringify(res.body), 'wallet:', wallet);

    // Pos-fix: totalBalance (palace-callback.service.ts) resta el locked.
    // El jugador tiene 100 en hold (disponible=0) → el proveedor recibe 0:
    // el saldo en hold NO aparece en los juegos.
    expect(res.body.result).toBe(0);
    expect(res.body.data?.balance).toBe(0);
  });

  it('palace bet: apostar plata en hold → check 31 (insufficient), no éxito', async () => {
    const res = await palaceRequest(ctx.request, {
      command: 'bet',
      data: { account: PALACE_ACCOUNT, trans_guid: 'hold-diag-bet-20', amount: '20', game_code: 'vswaysdogs' },
      check: '21,22,41,31',
    });

    console.log('[hold-diag] palace bet de 20 con disponible=0 → status:', res.status, 'body:', JSON.stringify(res.body));

    // Pos-fix: placeBetWithBonus valida contra `balance - locked_balance` y
    // el provider callback traduce InsufficientBalanceError a check 31.
    // El jugador no tiene saldo disponible (0), así que el bet se rechaza
    // con la semántica de "no tenés saldo para apostar".
    expect(res.body.status).toBe('ERROR');
    expect(res.body.result).toBe(CHECK_INSUFFICIENT_BALANCE);
  });
});
