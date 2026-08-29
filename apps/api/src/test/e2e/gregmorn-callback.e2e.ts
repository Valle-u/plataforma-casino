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

/** Rondas registradas para un `round_external_id` (ya normalizado, sin `_N`). */
async function readRounds(
  roundExternalId: string,
): Promise<{ bet: number; win: number; net: number; status: string }[]> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<
      { bet_amount: string; win_amount: string; net_amount: string; status: string }[]
    >`
      SELECT bet_amount, win_amount, net_amount, status
      FROM game_rounds WHERE round_external_id = ${roundExternalId}
    `;
    return rows.map((r) => ({
      bet: Number(r.bet_amount),
      win: Number(r.win_amount),
      net: Number(r.net_amount),
      status: r.status,
    }));
  } finally {
    await sql.end();
  }
}

/** Trazabilidad de una ronda: estado y los tres wallet tx que debe enlazar. */
async function readRoundTrace(roundExternalId: string): Promise<{
  status: string;
  bet_wallet_tx_id: string | null;
  win_wallet_tx_id: string | null;
  rollback_wallet_tx_id: string | null;
} | null> {
  const sql = postgres(getTestTenantUrl(), { max: 1 });
  try {
    const rows = await sql<
      {
        status: string;
        bet_wallet_tx_id: string | null;
        win_wallet_tx_id: string | null;
        rollback_wallet_tx_id: string | null;
      }[]
    >`
      SELECT status, bet_wallet_tx_id, win_wallet_tx_id, rollback_wallet_tx_id
      FROM game_rounds WHERE round_external_id = ${roundExternalId}
    `;
    return rows[0] ?? null;
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

  // ── Un spin en DOS callbacks (roundId sufijado _0 / _1) ───────────

  it('dos callbacks del mismo spin → UNA sola ronda, con los montos sumados', async () => {
    // Es como llega de verdad: el proveedor parte el spin en dos, con el
    // roundId sufijado. Antes esto creaba dos rondas y el conteo salía doble.
    const roundBase = '1349484390';

    await callback(
      ctx.request,
      writeBet({
        transactionId: 'tx-round-split-bet',
        bet: 200,
        roundId: `${roundBase}_0`,
        round_finished: false,
      }),
    );
    await callback(
      ctx.request,
      writeBet({
        transactionId: 'tx-round-split-win',
        bet: 0,
        win: 100,
        roundId: `${roundBase}_1`,
        round_finished: true,
      }),
    );

    const rounds = await readRounds(roundBase);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      bet: 200,
      win: 100,
      net: -100,
      status: 'settled',
    });
  });

  it('compra de tiradas gratis: N acciones con el MISMO roundId interno → UNA ronda', async () => {
    // Los juegos con compra de features mandan UNA ACCION POR CALLBACK, y el
    // `roundId` de arriba es un UUID distinto en cada una. El id real de la
    // ronda viaja adentro de `info`. En prod una sola compra genero 30
    // callbacks (spin + pick + 28 freeSpin/freeReSpin); sin agrupar por el id
    // interno quedaban 30 rondas, 29 de ellas en `placed` para siempre.
    const inner = '1787962756';
    const info = (action: string): string =>
      `&sessionId=69929384&gameId=${GAME_ID}&roundId=${inner}&action=${action}`;

    // La compra: cobra la apuesta y deja la ronda ABIERTA.
    await callback(
      ctx.request,
      writeBet({
        transactionId: 'tx-fs-buy',
        bet: 10,
        win: 2,
        roundId: 'b1b0c0de-0000-4000-8000-000000000001',
        round_finished: false,
        info: info('spin'),
      }),
    );

    // Las tiradas gratis: bet 0, y la ultima cierra la ronda.
    const wins = [0, 1, 0, 3];
    for (const [i, win] of wins.entries()) {
      await callback(
        ctx.request,
        writeBet({
          transactionId: `tx-fs-${i}`,
          bet: 0,
          win,
          roundId: `b1b0c0de-0000-4000-8000-00000000001${i}`,
          round_finished: i === wins.length - 1,
          info: info('freeSpin'),
        }),
      );
    }

    // UNA ronda: la apuesta de la compra y la suma de TODOS los premios.
    const rounds = await readRounds(inner);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      bet: 10,
      win: 6, // 2 de la compra + 1 + 3 de las tiradas
      net: -4,
      status: 'settled',
    });

    // Y ninguna quedo colgada bajo el UUID de una accion suelta.
    expect(await readRounds('b1b0c0de-0000-4000-8000-000000000001')).toHaveLength(0);
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

  it('la ronda enlaza el wallet tx del bet Y el del win (trazabilidad)', async () => {
    const round = '1349500001';
    await callback(
      ctx.request,
      writeBet({ transactionId: 'tx-trace-bet', bet: 60, roundId: `${round}_0` }),
    );
    await callback(
      ctx.request,
      writeBet({
        transactionId: 'tx-trace-win',
        bet: 0,
        win: 90,
        roundId: `${round}_1`,
        round_finished: true,
      }),
    );

    const t = await readRoundTrace(round);
    expect(t).not.toBeNull();
    expect(t!.status).toBe('settled');
    // Sin estos dos, no se puede auditar una jugada contra el ledger.
    expect(t!.bet_wallet_tx_id).not.toBeNull();
    expect(t!.win_wallet_tx_id).not.toBeNull();
  });

  it('el rollback marca la ronda como anulada — si no, se cobra comisión sobre ella', async () => {
    const round = '1349500002';
    const txId = 'tx-trace-rollback';

    await callback(
      ctx.request,
      writeBet({ transactionId: txId, bet: 70, roundId: `${round}_0`, round_finished: true }),
    );
    expect((await readRoundTrace(round))!.status).toBe('settled');

    await callback(ctx.request, {
      cmd: 'rollback',
      login: LOGIN,
      sessionid: 'sess-e2e-1',
      bet: 70,
      win: 0,
      transactionId: txId,
      roundId: `${round}_0`,
      gameId: GAME_ID,
      round_finished: true,
      info: '{}',
    });

    const t = await readRoundTrace(round);
    // El motor de comisiones y las estadísticas excluyen 'rolled_back'. Si la
    // ronda quedara 'settled', el operador cobraría por una jugada anulada.
    expect(t!.status).toBe('rolled_back');
    expect(t!.rollback_wallet_tx_id).not.toBeNull();
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

  // ── Fallback sin token (URL vieja del intake) ─────────────────────

  it('URL SIN token con firma válida → funciona por el fallback de tenant único', async () => {
    const res = await callback(
      ctx.request,
      { cmd: 'getBalance', login: LOGIN, sessionid: 'sess-e2e-1' },
      { route: '/api/v1/game-provider/gregmorn/callback' },
    );
    expect(res.status).toBe(200);
    const body = res.body as CallbackBody;
    expect(body.status).toBe('success');
    expect(body.balance).toBe(await readBalance(userId));
  });

  it('URL SIN token con firma INVÁLIDA → 400 y NO mueve plata', async () => {
    // Lo que autentica sigue siendo la firma, no el token: sin token el
    // fallback resuelve el tenant, pero un tercero igual no puede firmar.
    const before = await readBalance(userId);
    const res = await callback(
      ctx.request,
      writeBet({ transactionId: 'tx-notoken-badsig-1', bet: 700 }),
      { route: '/api/v1/game-provider/gregmorn/callback', tamper: true },
    );
    expect(res.status).toBe(400);
    expect((res.body as CallbackBody).error).toMatch(/INVALID_SIGNATURE/);
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
