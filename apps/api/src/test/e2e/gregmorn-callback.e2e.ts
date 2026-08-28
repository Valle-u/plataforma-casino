/**
 * E2E: callbacks seamless de Gregmorn (Fase 5) — el camino de plata real.
 *
 * Se prueba contra una DB real, no mocks. Lo que cubre:
 *   - getBalance devuelve el saldo jugable (y NUNCA 0 ante la duda).
 *   - writeBet con bet → burn; con win → mint; con las dos en el mismo callback.
 *   - **La trampa #1**: el rollback llega con el MISMO `transactionId` que el
 *     bet y IGUAL tiene que devolver la plata. Es el test que justifica que la
 *     clave de idempotencia sea `cmd + transactionId`.
 *   - Idempotencia de writeBet y de rollback (repetir no re-aplica).
 *   - **La trampa #2**: montos en string (vendors SL-Games / X-Games).
 *   - Monto no parseable → rechazo sin mover plata (nunca se asume 0).
 *   - Firma inválida y token equivocado → rechazo sin mover plata.
 *   - Saldo insuficiente y jugador inexistente → HTTP 400 `fail`.
 *
 * Setup: `gregmorn_callback_token` en la DB de control (antes del bootstrap,
 * para que el cache del controller lo levante) + `secret_api_key` en
 * tenant_settings + un jugador con saldo. Los callbacks se firman con nuestro
 * propio `signGregmornBody`.
 */

import postgres from 'postgres';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { getControlUrl, getTestTenantUrl } from '../setup/db-helpers';
import { TEST_TENANT } from '../setup/test-tenant';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { signGregmornBody } from '../../games/providers/gregmorn/gregmorn-signer';

const TOKEN = 'test-gregmorn-callback-token';
const SECRET = 'sk_test_2f8c41a9e04d6cb3157ae0d2f89b6c77';
const LOGIN = 'gregmorn_player';
const ROUTE = `/api/v1/game-provider/gregmorn/callback/${TOKEN}`;
const GAME_ID = 'integration_a:provider_a:game_001';

interface CallbackBody {
  balance: number;
  currency: string;
  error: string;
  login: string;
  status: 'success' | 'fail';
}

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
      VALUES (gen_random_uuid(), ${LOGIN}, 'Gregmorn Player', 'test-no-login', 'active')
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
      VALUES (gen_random_uuid(), ${w[0]!.id}, 'mint', '1000.00', '1000.00', 'test_funding',
        'fondeo test gregmorn', 'e2e-gregmorn-fund')
    `;
    return userId;
  } finally {
    await sql.end();
  }
}

async function seedGame(): Promise<void> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    await sql`
      INSERT INTO games (id, code, name, provider_code, category, config)
      VALUES (gen_random_uuid(), 'gregmorn_rounds_test', 'Gregmorn Rounds Test',
        'gregmorn', 'slots',
        ${sql.json({ gregmorn: { gameId: GAME_ID, provider: 'PG Soft' } })})
    `;
  } finally {
    await sql.end();
  }
}

/** POST firmado al callback. `opts.tamper` rompe la firma; `opts.route` la pisa. */
function callback(
  request: TestApp['request'],
  body: Record<string, unknown>,
  opts: { tamper?: boolean; route?: string } = {},
) {
  const raw = JSON.stringify(body);
  const signature = opts.tamper
    ? signGregmornBody(raw, 'clave-del-atacante')
    : signGregmornBody(raw, SECRET);
  return request
    .post(opts.route ?? ROUTE)
    .set('Content-Type', 'application/json')
    .set('X-Signature', signature)
    .send(raw);
}

function writeBet(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cmd: 'writeBet',
    login: LOGIN,
    sessionid: 'sess-e2e-1',
    bet: 0,
    win: 0,
    transactionId: 'tx-default',
    gameId: GAME_ID,
    round_finished: true,
    info: '{}',
    ...over,
  };
}

describe('Gregmorn callback (E2E)', () => {
  let ctx: TestApp;
  let userId: string;

  beforeAll(async () => {
    const control = postgres(getControlUrl(), { max: 1 });
    try {
      await control`
        UPDATE tenants SET gregmorn_callback_token = ${TOKEN} WHERE slug = ${TEST_TENANT.slug}
      `;
    } finally {
      await control.end();
    }

    ctx = await bootstrapTestApp();

    await ctx.app
      .get(TenantSettingsService)
      .set(ctx.tenantDb, 'game_provider.gregmorn.secret_api_key', SECRET, null);

    userId = await seedPlayer();
    await seedGame();
  });

  afterAll(async () => {
    const control = postgres(getControlUrl(), { max: 1 });
    try {
      await control`
        UPDATE tenants SET gregmorn_callback_token = NULL WHERE slug = ${TEST_TENANT.slug}
      `;
    } finally {
      await control.end();
    }
    await ctx.close();
  });

  // ── getBalance ────────────────────────────────────────────────────

  it('getBalance → saldo jugable', async () => {
    const res = await callback(ctx.request, {
      cmd: 'getBalance',
      login: LOGIN,
      sessionid: 'sess-e2e-1',
    });
    expect(res.status).toBe(200);
    const body = res.body as CallbackBody;
    expect(body.status).toBe('success');
    expect(body.login).toBe(LOGIN);
    expect(body.balance).toBe(await readBalance(userId));
  });

  it('getBalance de un jugador inexistente → 400 fail, NO saldo 0', async () => {
    const res = await callback(ctx.request, {
      cmd: 'getBalance',
      login: 'no_existe',
      sessionid: 's',
    });
    expect(res.status).toBe(400);
    const body = res.body as CallbackBody;
    expect(body.status).toBe('fail');
    expect(body.error).toBe('UNKNOWN_PLAYER');
  });

  // ── writeBet ──────────────────────────────────────────────────────

  it('writeBet con bet → burn', async () => {
    const before = await readBalance(userId);
    const res = await callback(ctx.request, writeBet({ transactionId: 'tx-bet-1', bet: 100 }));
    expect(res.status).toBe(200);
    expect((res.body as CallbackBody).status).toBe('success');
    expect(await readBalance(userId)).toBeCloseTo(before - 100, 2);
  });

  it('writeBet con win → mint', async () => {
    const before = await readBalance(userId);
    const res = await callback(ctx.request, writeBet({ transactionId: 'tx-win-1', win: 250 }));
    expect(res.status).toBe(200);
    expect(await readBalance(userId)).toBeCloseTo(before + 250, 2);
  });

  it('writeBet con bet Y win en el mismo callback → aplica las dos patas', async () => {
    const before = await readBalance(userId);
    const res = await callback(
      ctx.request,
      writeBet({ transactionId: 'tx-both-1', bet: 50, win: 80 }),
    );
    expect(res.status).toBe(200);
    expect(await readBalance(userId)).toBeCloseTo(before - 50 + 80, 2);
  });

  it('el balance devuelto es el de DESPUÉS de aplicar', async () => {
    const res = await callback(ctx.request, writeBet({ transactionId: 'tx-after-1', bet: 10 }));
    expect((res.body as CallbackBody).balance).toBeCloseTo(await readBalance(userId), 2);
  });

  it('writeBet repetido → no re-aplica y devuelve el saldo actual', async () => {
    await callback(ctx.request, writeBet({ transactionId: 'tx-dup-1', bet: 30 }));
    const after = await readBalance(userId);

    const res = await callback(ctx.request, writeBet({ transactionId: 'tx-dup-1', bet: 30 }));
    expect(res.status).toBe(200);
    expect((res.body as CallbackBody).status).toBe('success');
    expect(await readBalance(userId)).toBeCloseTo(after, 2);
  });

  // ── Trampa #2: montos en string ───────────────────────────────────

  it('acepta bet y win como STRING (vendors SL-Games / X-Games)', async () => {
    const before = await readBalance(userId);
    const res = await callback(
      ctx.request,
      writeBet({ transactionId: 'tx-str-1', bet: '25.50', win: '10.25' }),
    );
    expect(res.status).toBe(200);
    expect(await readBalance(userId)).toBeCloseTo(before - 25.5 + 10.25, 2);
  });

  it('monto no parseable → 400 y NO mueve plata (nunca asume 0)', async () => {
    const before = await readBalance(userId);
    const res = await callback(
      ctx.request,
      writeBet({ transactionId: 'tx-bad-1', bet: 'abc' }),
    );
    expect(res.status).toBe(400);
    expect((res.body as CallbackBody).error).toBe('INVALID_BET_AMOUNT');
    expect(await readBalance(userId)).toBeCloseTo(before, 2);
  });

  // ── Trampa #1: el rollback repite el transactionId del bet ─────────

  it('TRAMPA #1: el rollback con el MISMO transactionId que el bet devuelve la plata', async () => {
    const txId = 'tx-rollback-shared-1';

    const before = await readBalance(userId);
    await callback(ctx.request, writeBet({ transactionId: txId, bet: 200 }));
    expect(await readBalance(userId)).toBeCloseTo(before - 200, 2);

    // Mismo transactionId, otro cmd. Si la idempotencia fuera por el id crudo,
    // esto se descartaría como duplicado y el jugador perdería los 200.
    const res = await callback(ctx.request, {
      cmd: 'rollback',
      login: LOGIN,
      sessionid: 'sess-e2e-1',
      bet: 200,
      win: 0,
      transactionId: txId,
      gameId: GAME_ID,
      round_finished: true,
      info: '{}',
    });

    expect(res.status).toBe(200);
    expect((res.body as CallbackBody).status).toBe('success');
    expect(await readBalance(userId)).toBeCloseTo(before, 2);
  });

  it('rollback repetido → no acredita dos veces', async () => {
    const txId = 'tx-rollback-dup-1';
    await callback(ctx.request, writeBet({ transactionId: txId, bet: 40 }));

    const rollback = {
      cmd: 'rollback',
      login: LOGIN,
      sessionid: 'sess-e2e-1',
      bet: 40,
      win: 0,
      transactionId: txId,
      gameId: GAME_ID,
      round_finished: true,
      info: '{}',
    };

    await callback(ctx.request, rollback);
    const afterFirst = await readBalance(userId);

    const res = await callback(ctx.request, rollback);
    expect(res.status).toBe(200);
    expect(await readBalance(userId)).toBeCloseTo(afterFirst, 2);
  });

  it('rollback de una transacción que no tenemos → 400, no mintea de la nada', async () => {
    const before = await readBalance(userId);
    const res = await callback(ctx.request, {
      cmd: 'rollback',
      login: LOGIN,
      sessionid: 'sess-e2e-1',
      bet: 999,
      win: 0,
      transactionId: 'tx-que-nunca-vimos',
      gameId: GAME_ID,
      round_finished: true,
      info: '{}',
    });
    expect(res.status).toBe(400);
    expect((res.body as CallbackBody).error).toBe('UNKNOWN_TRANSACTION');
    expect(await readBalance(userId)).toBeCloseTo(before, 2);
  });

  // ── Seguridad ─────────────────────────────────────────────────────

  it('firma inválida → 400 y NO mueve plata', async () => {
    const before = await readBalance(userId);
    const res = await callback(
      ctx.request,
      writeBet({ transactionId: 'tx-badsig-1', bet: 500 }),
      { tamper: true },
    );
    expect(res.status).toBe(400);
    expect((res.body as CallbackBody).error).toMatch(/INVALID_SIGNATURE/);
    expect(await readBalance(userId)).toBeCloseTo(before, 2);
  });

  it('token de callback desconocido → 400 y NO mueve plata', async () => {
    const before = await readBalance(userId);
    const res = await callback(
      ctx.request,
      writeBet({ transactionId: 'tx-badtoken-1', bet: 500 }),
      { route: '/api/v1/game-provider/gregmorn/callback/token-que-no-existe' },
    );
    expect(res.status).toBe(400);
    expect((res.body as CallbackBody).error).toBe('INVALID_CALLBACK_TOKEN');
    expect(await readBalance(userId)).toBeCloseTo(before, 2);
  });

  it('cmd desconocido → 400', async () => {
    const res = await callback(ctx.request, {
      cmd: 'transferirTodo',
      login: LOGIN,
      sessionid: 's',
    });
    expect(res.status).toBe(400);
    expect((res.body as CallbackBody).error).toMatch(/INVALID_CMD/);
  });

  // ── Fondos ────────────────────────────────────────────────────────

  it('saldo insuficiente → 400 fail y NO mueve plata', async () => {
    const before = await readBalance(userId);
    const res = await callback(
      ctx.request,
      writeBet({ transactionId: 'tx-insuf-1', bet: before + 10_000 }),
    );
    expect(res.status).toBe(400);
    expect((res.body as CallbackBody).status).toBe('fail');
    expect(await readBalance(userId)).toBeCloseTo(before, 2);
  });

  it('win por encima del tope de sanidad → 400 y NO mintea (LEY E7)', async () => {
    await ctx.app
      .get(TenantSettingsService)
      .set(ctx.tenantDb, 'game_provider.gregmorn.win_max_amount', 1000, null);
    try {
      const before = await readBalance(userId);
      const res = await callback(
        ctx.request,
        writeBet({ transactionId: 'tx-cap-1', win: 5000 }),
      );
      expect(res.status).toBe(400);
      expect((res.body as CallbackBody).error).toBe('WIN_OVER_CAP');
      expect(await readBalance(userId)).toBeCloseTo(before, 2);
    } finally {
      await ctx.app
        .get(TenantSettingsService)
        .set(ctx.tenantDb, 'game_provider.gregmorn.win_max_amount', 50_000_000, null);
    }
  });
});
