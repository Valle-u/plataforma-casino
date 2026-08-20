/**
 * E2E: callback seamless de Forever (F2) — el camino de plata real.
 *
 * Verifica en una DB real:
 *   - GetBalance devuelve el saldo jugable.
 *   - ChangeBalance txnType 0 (Debit/bet) → burn (resta).
 *   - ChangeBalance txnType 1 (Credit/win) → mint (suma).
 *   - ChangeBalance txnType 2 (Cancel) → mint (reversa, suma).
 *   - Idempotencia por txnCode (un callback repetido no re-aplica).
 *   - Firma inválida → rechazo, NO mueve plata.
 *   - Saldo insuficiente → status 8.
 *   - Usuario inexistente → status 5.
 *
 * Setup: forever_agent_code en control DB (pre-bootstrap, para el cache) +
 * la public key de verificación en tenant_settings + un jugador con saldo.
 * Firmamos los callbacks con nuestro propio signForeverRequest (Ed25519).
 */

import postgres from 'postgres';
import { generateKeyPairSync } from 'node:crypto';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { getControlUrl, getTestTenantUrl } from '../setup/db-helpers';
import { TEST_TENANT } from '../setup/test-tenant';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { signForeverRequest } from '../../games/providers/forever/forever-signer';

const AGENT_CODE = 'test-forever-agent';
const USER_CODE = 'forever_player';
const ROUTE = '/api/v1/game-provider/forever/callback';

function freshKeyPairBase64(): { priv: string; pub: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    priv: Buffer.from(pkcs8.subarray(pkcs8.length - 32)).toString('base64'),
    pub: Buffer.from(spki.subarray(spki.length - 32)).toString('base64'),
  };
}

const KEYS = freshKeyPairBase64();

async function readBalance(userId: string): Promise<number> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<{ balance: string }[]>`
      SELECT balance FROM wallets WHERE user_id = ${userId}
    `;
    return Number(rows[0]?.balance ?? '0');
  } finally {
    await sql.end();
  }
}

async function seedPlayer(): Promise<string> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const u = await sql<{ id: string }[]>`
      INSERT INTO users (id, username, display_name, password_hash, status)
      VALUES (gen_random_uuid(), ${USER_CODE}, 'Forever Player', 'test-no-login', 'active')
      RETURNING id
    `;
    const userId = u[0]!.id;
    const w = await sql<{ id: string }[]>`
      INSERT INTO wallets (id, user_id, balance, bonus_balance, locked_balance)
      VALUES (gen_random_uuid(), ${userId}, '1000.00', '0.00', '0.00')
      RETURNING id
    `;
    await sql`
      INSERT INTO wallet_transactions (id, wallet_id, type, amount, balance_after, source, reason, idempotency_key)
      VALUES (gen_random_uuid(), ${w[0]!.id}, 'mint', '1000.00', '1000.00', 'test_funding', 'fondeo test forever', 'e2e-forever-fund')
    `;
    return userId;
  } finally {
    await sql.end();
  }
}

/** Crea un juego de Forever (vendorCode/gameCode en config.forever). */
async function seedForeverGame(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql`
      INSERT INTO games (id, code, name, provider_code, category, config)
      VALUES (gen_random_uuid(), 'forever_rounds_test', 'Forever Rounds Test',
        'forever', 'slots',
        ${sql.json({ forever: { vendorCode: 'vr', gameCode: 'grounds' } })})
    `;
  } finally {
    await sql.end();
  }
}

/** Lee el game_round de un wagerId (round_external_id). */
async function readGameRound(
  roundExternalId: string,
): Promise<{ status: string; bet: number; win: number; net: number } | null> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<
      { status: string; bet_amount: string; win_amount: string; net_amount: string }[]
    >`
      SELECT status, bet_amount, win_amount, net_amount
      FROM game_rounds WHERE round_external_id = ${roundExternalId}
    `;
    const r = rows[0];
    return r
      ? { status: r.status, bet: Number(r.bet_amount), win: Number(r.win_amount), net: Number(r.net_amount) }
      : null;
  } finally {
    await sql.end();
  }
}

interface CallbackResult {
  status: number;
  msg: string;
  balance?: number;
}

function foreverCallback(
  request: TestApp['request'],
  body: Record<string, unknown>,
  opts: { tamper?: boolean } = {},
) {
  const raw = JSON.stringify(body);
  const sig = signForeverRequest({ agentCode: AGENT_CODE, privateKeyBase64: KEYS.priv, body: raw });
  const headers = { ...sig.headers };
  if (opts.tamper) {
    const cur = headers['X-Forever-Sig-Value'] ?? '';
    headers['X-Forever-Sig-Value'] = 'AAAA' + cur.slice(4);
  }
  return request
    .post(ROUTE)
    .set('Content-Type', 'application/json')
    .set(headers)
    .send(raw);
}

describe('Forever callback (E2E)', () => {
  let ctx: TestApp;
  let userId: string;

  beforeAll(async () => {
    const control = postgres(getControlUrl(), { max: 1 });
    try {
      await control`
        UPDATE tenants SET forever_agent_code = ${AGENT_CODE} WHERE slug = ${TEST_TENANT.slug}
      `;
    } finally {
      await control.end();
    }

    ctx = await bootstrapTestApp();

    // Cargar la public key de verificación en tenant_settings.
    await ctx.app
      .get(TenantSettingsService)
      .set(ctx.tenantDb, 'game_provider.forever.callback_verify_public_key', KEYS.pub, null);

    userId = await seedPlayer();
  });

  afterAll(async () => {
    const control = postgres(getControlUrl(), { max: 1 });
    try {
      await control`
        UPDATE tenants SET forever_agent_code = NULL WHERE slug = ${TEST_TENANT.slug}
      `;
    } finally {
      await control.end();
    }
    await ctx.close();
  });

  it('GetBalance → saldo jugable', async () => {
    const res = await foreverCallback(ctx.request, {
      method: 'GetBalance',
      token: 'x',
      userCode: USER_CODE,
      currencyCode: 'USD',
    });
    expect(res.status).toBe(200);
    const body = res.body as CallbackResult;
    expect(body.status).toBe(0);
    expect(body.balance).toBe(await readBalance(userId));
  });

  it('ChangeBalance Debit (bet) → burn', async () => {
    const before = await readBalance(userId);
    const res = await foreverCallback(ctx.request, {
      method: 'ChangeBalance', token: 'x', userCode: USER_CODE, currencyCode: 'USD',
      vendorCode: 'v1', txnType: 0, wagerId: 1, txnCode: 'bet-1', amount: 100, isFinished: true, isFreeRound: false,
    });
    expect((res.body as CallbackResult).status).toBe(0);
    expect(await readBalance(userId)).toBeCloseTo(before - 100, 2);
  });

  it('ChangeBalance Credit (win) → mint', async () => {
    const before = await readBalance(userId);
    const res = await foreverCallback(ctx.request, {
      method: 'ChangeBalance', token: 'x', userCode: USER_CODE, currencyCode: 'USD',
      vendorCode: 'v1', txnType: 1, wagerId: 1, txnCode: 'win-1', amount: 250, isFinished: true, isFreeRound: false,
    });
    expect((res.body as CallbackResult).status).toBe(0);
    expect(await readBalance(userId)).toBeCloseTo(before + 250, 2);
  });

  it('ChangeBalance Cancel → mint (reversa)', async () => {
    const before = await readBalance(userId);
    const res = await foreverCallback(ctx.request, {
      method: 'ChangeBalance', token: 'x', userCode: USER_CODE, currencyCode: 'USD',
      vendorCode: 'v1', txnType: 2, wagerId: 1, txnCode: 'cancel-1', amount: 100, isFinished: true, isFreeRound: false,
    });
    expect((res.body as CallbackResult).status).toBe(0);
    expect(await readBalance(userId)).toBeCloseTo(before + 100, 2);
  });

  it('idempotencia: mismo txnCode no re-aplica', async () => {
    const before = await readBalance(userId);
    const body = {
      method: 'ChangeBalance', token: 'x', userCode: USER_CODE, currencyCode: 'USD',
      vendorCode: 'v1', txnType: 0, wagerId: 9, txnCode: 'dup-1', amount: 40, isFinished: true, isFreeRound: false,
    };
    await foreverCallback(ctx.request, body);
    const mid = await readBalance(userId);
    expect(mid).toBeCloseTo(before - 40, 2);
    // Segundo callback idéntico: no vuelve a restar.
    const res2 = await foreverCallback(ctx.request, body);
    expect((res2.body as CallbackResult).status).toBe(0);
    expect(await readBalance(userId)).toBeCloseTo(mid, 2);
  });

  it('firma inválida → rechazo, NO mueve plata', async () => {
    const before = await readBalance(userId);
    const res = await foreverCallback(
      ctx.request,
      {
        method: 'ChangeBalance', token: 'x', userCode: USER_CODE, currencyCode: 'USD',
        vendorCode: 'v1', txnType: 0, wagerId: 2, txnCode: 'bad-sig-1', amount: 500, isFinished: true, isFreeRound: false,
      },
      { tamper: true },
    );
    expect((res.body as CallbackResult).status).toBe(3); // INVALID_AGENT
    expect(await readBalance(userId)).toBeCloseTo(before, 2);
  });

  it('saldo insuficiente → status 8', async () => {
    const res = await foreverCallback(ctx.request, {
      method: 'ChangeBalance', token: 'x', userCode: USER_CODE, currencyCode: 'USD',
      vendorCode: 'v1', txnType: 0, wagerId: 3, txnCode: 'huge-bet-1', amount: 9_999_999, isFinished: true, isFreeRound: false,
    });
    expect((res.body as CallbackResult).status).toBe(8); // INSUFFICIENT_MONEY
  });

  it('usuario inexistente → status 5', async () => {
    const res = await foreverCallback(ctx.request, {
      method: 'GetBalance', token: 'x', userCode: 'no_existe', currencyCode: 'USD',
    });
    expect((res.body as CallbackResult).status).toBe(5); // INVALID_USER
  });

  it('game_round sync: bet + win (mismo wagerId) → round settled con net correcto', async () => {
    await seedForeverGame();

    // Bet 100 (con gameCode → syncGameRound crea el round 'placed').
    const bet = await foreverCallback(ctx.request, {
      method: 'ChangeBalance', token: 'x', userCode: USER_CODE, currencyCode: 'ARS',
      vendorCode: 'vr', gameCode: 'grounds', txnType: 0, wagerId: 500, txnCode: 'gr-bet-1',
      amount: 100, isFinished: false, isFreeRound: false,
    });
    expect((bet.body as CallbackResult).status).toBe(0);
    let round = await readGameRound('500');
    expect(round).not.toBeNull();
    expect(round!.status).toBe('placed');
    expect(round!.bet).toBeCloseTo(100, 2);

    // Win 300 (mismo wagerId → update a 'settled', net = 300 - 100 = 200).
    const win = await foreverCallback(ctx.request, {
      method: 'ChangeBalance', token: 'x', userCode: USER_CODE, currencyCode: 'ARS',
      vendorCode: 'vr', gameCode: 'grounds', txnType: 1, wagerId: 500, txnCode: 'gr-win-1',
      amount: 300, isFinished: true, isFreeRound: false,
    });
    expect((win.body as CallbackResult).status).toBe(0);
    round = await readGameRound('500');
    expect(round!.status).toBe('settled');
    expect(round!.win).toBeCloseTo(300, 2);
    expect(round!.net).toBeCloseTo(200, 2);
  });
});
