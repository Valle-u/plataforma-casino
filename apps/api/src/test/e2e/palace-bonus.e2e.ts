/**
 * E2E: lógica de bonos en el flujo de Palace Casino (seamless wallet).
 *
 * Objetivo: verificar en una DB real a DÓNDE va cada peso cuando un
 * jugador con plata de bono juega por Palace.
 *
 * Escenarios:
 *   1. balance/authenticate → devuelve real + bono (total jugable).
 *   2. bet → consume bono PRIMERO, luego real (split en placeBetWithBonus).
 *   3. win → acredita SIEMPRE al balance real (nunca al bono).
 *   4. cancel de un bet que salió del bono → la reversa va al balance
 *      REAL (no restaura el bono).
 *   5. bet mayor que real+bono → check 31 (insufficient balance).
 *
 * Precondiciones del tenant de test:
 *   - Seteamos `palace_callback_token` en la control DB (el seed no lo
 *     tiene) ANTES del bootstrap para que el cache del controller lo
 *     precargue en onModuleInit.
 *   - Creamos un jugador con `palace_account` + wallet con real y bono
 *     via SQL directo (no existe endpoint para setear palace_account).
 */

import postgres from 'postgres';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { getControlUrl, getTestTenantUrl } from '../setup/db-helpers';
import { TEST_TENANT } from '../setup/test-tenant';

const CALLBACK_TOKEN = 'test-palace-callback-token';
const PALACE_ACCOUNT = 'u_jugador_bono';
const PALACE_ROUTE = '/api/v1/game-provider/palace/callback';

/** Result codes del proveedor (espejo de PALACE_RESULT). */
const OK = 0;
const CHECK_INSUFFICIENT_BALANCE = 31;

interface WalletState {
  balance: string;
  bonusBalance: string;
}

/** Lee el estado de la wallet en la DB del tenant de test. */
async function readWallet(userId: string): Promise<WalletState> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ balance: string; bonus_balance: string }[]>`
      SELECT balance, bonus_balance
      FROM wallets
      WHERE user_id = ${userId}
    `;
    const row = rows[0];
    if (!row) throw new Error('Wallet no encontrada');
    return { balance: row.balance, bonusBalance: row.bonus_balance };
  } finally {
    await sql.end();
  }
}

/**
 * Crea el jugador Palace + su wallet con saldo real y bono.
 * Retorna el userId para poder inspeccionar la wallet después.
 */
async function seedPalacePlayer(): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const u = await sql<{ id: string }[]>`
      INSERT INTO users (id, username, display_name, password_hash, status, palace_account, palace_user_code)
      VALUES (gen_random_uuid(), 'jugador_bono', 'Jugador Bono', 'test-no-login', 'active', ${PALACE_ACCOUNT}, 1001)
      RETURNING id
    `;
    const userId = u[0]!.id;

    const w = await sql<{ id: string }[]>`
      INSERT INTO wallets (id, user_id, balance, bonus_balance, locked_balance)
      VALUES (gen_random_uuid(), ${userId}, '1000.00', '500.00', '0.00')
      RETURNING id
    `;
    const walletId = w[0]!.id;

    // Invariante `balance == Σtx`: respaldar el fondeo con txs reales.
    await sql`
      INSERT INTO wallet_transactions
        (id, wallet_id, type, amount, balance_after, source, reason, idempotency_key)
      VALUES
        (gen_random_uuid(), ${walletId}, 'mint', '1000.00', '1000.00', 'test_funding', 'fondeo real de test', 'e2e-palace-fund-real'),
        (gen_random_uuid(), ${walletId}, 'bonus_credit', '500.00', '1000.00', 'test_funding', 'bono de test', 'e2e-palace-fund-bonus')
    `;
    return userId;
  } finally {
    await sql.end();
  }
}

/** Pega un callback al endpoint de Palace con el token del tenant. */
function palaceRequest(request: TestApp['request'], body: Record<string, unknown>) {
  return request.post(PALACE_ROUTE).set('Callback-Token', CALLBACK_TOKEN).send(body);
}

describe('Palace + bonus (E2E)', () => {
  let ctx: TestApp;
  let playerUserId: string;

  beforeAll(async () => {
    // 1. Setear el palace_callback_token en control DB ANTES del bootstrap
    //    para que onModuleInit lo precargue en el token cache.
    const control = postgres(getControlUrl(), { max: 1 });
    try {
      await control`
        UPDATE tenants SET palace_callback_token = ${CALLBACK_TOKEN}
        WHERE slug = ${TEST_TENANT.slug}
      `;
    } finally {
      await control.end();
    }

    // 2. Bootstrap de la app.
    ctx = await bootstrapTestApp();

    // 3. Crear jugador Palace con real + bono.
    playerUserId = await seedPalacePlayer();
  });

  afterAll(async () => {
    // Limpiar el token de la control DB para no contaminar otras suites.
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

  it('balance devuelve real + bono (total jugable)', async () => {
    const res = await palaceRequest(ctx.request, {
      command: 'balance',
      data: { account: PALACE_ACCOUNT },
      check: '21,22',
    });

    expect(res.status).toBe(200);
    expect(res.body.result).toBe(OK);
    expect(res.body.status).toBe('OK');
    // 1000 real + 500 bono = 1500 total jugable.
    expect(res.body.data).toEqual({ balance: 1500 });
  });

  it('authenticate devuelve el mismo total', async () => {
    const res = await palaceRequest(ctx.request, {
      command: 'authenticate',
      data: { account: PALACE_ACCOUNT },
      check: '21',
    });

    expect(res.body.result).toBe(OK);
    expect(res.body.data).toEqual({ account: PALACE_ACCOUNT, balance: 1500 });
  });

  it('bet consume el BONO primero, no toca la real', async () => {
    const res = await palaceRequest(ctx.request, {
      command: 'bet',
      data: { account: PALACE_ACCOUNT, trans_guid: 'e2e-bet-100', amount: '100', game_code: 'vswaysdogs' },
      check: '21,22,41,31',
    });

    expect(res.body.result).toBe(OK);
    // Después del bet: 1000 real + 400 bono = 1400.
    expect(res.body.data).toEqual({ balance: 1400 });

    const wallet = await readWallet(playerUserId);
    expect(wallet.balance).toBe('1000.00');
    expect(wallet.bonusBalance).toBe('400.00');
  });

  it('win acredita SIEMPRE al balance real (nunca al bono)', async () => {
    const res = await palaceRequest(ctx.request, {
      command: 'win',
      data: {
        account: PALACE_ACCOUNT,
        trans_guid: 'e2e-win-300',
        amount: '300',
        round_id: 'round-1',
        game_code: 'vswaysdogs',
      },
      check: '21,22,41',
    });

    expect(res.body.result).toBe(OK);
    // 1300 real + 400 bono = 1700.
    expect(res.body.data).toEqual({ balance: 1700 });

    const wallet = await readWallet(playerUserId);
    // El win va a la real: 1000 → 1300. El bono queda intacto.
    expect(wallet.balance).toBe('1300.00');
    expect(wallet.bonusBalance).toBe('400.00');
  });

  it('cancel de un bet que salió del bono revierte al balance REAL', async () => {
    const res = await palaceRequest(ctx.request, {
      command: 'cancel',
      data: {
        account: PALACE_ACCOUNT,
        trans_guid: 'e2e-cancel-100',
        cancel_trans_guid: 'e2e-bet-100',
      },
      check: '21,22,41,43',
    });

    expect(res.body.result).toBe(OK);
    // El bet de 100 se revierte a la real: 1300 → 1400. Bono queda en 400.
    const wallet = await readWallet(playerUserId);
    expect(wallet.balance).toBe('1400.00');
    expect(wallet.bonusBalance).toBe('400.00');
  });

  it('bet mayor que real+bono → check 31 (insufficient balance)', async () => {
    const res = await palaceRequest(ctx.request, {
      command: 'bet',
      data: { account: PALACE_ACCOUNT, trans_guid: 'e2e-bet-huge', amount: '999999' },
      check: '21,22,41,31',
    });

    expect(res.body.result).toBe(CHECK_INSUFFICIENT_BALANCE);
    expect(res.body.status).toBe('ERROR');
    // Devuelve el total jugable actual: 1400 real + 400 bono = 1800.
    expect(res.body.data).toEqual({ balance: 1800 });
  });

  it('bet mixto: consume bono hasta agotarlo y luego la real', async () => {
    // Estado actual: 1400 real + 400 bono. Apostamos 500 → 400 de bono
    // + 100 de la real.
    const res = await palaceRequest(ctx.request, {
      command: 'bet',
      data: { account: PALACE_ACCOUNT, trans_guid: 'e2e-bet-mixed', amount: '500', game_code: 'vswaysdogs' },
      check: '21,22,41,31',
    });

    expect(res.body.result).toBe(OK);
    // 1300 real + 0 bono = 1300.
    expect(res.body.data).toEqual({ balance: 1300 });

    const wallet = await readWallet(playerUserId);
    expect(wallet.balance).toBe('1300.00');
    expect(wallet.bonusBalance).toBe('0.00');
  });
});
