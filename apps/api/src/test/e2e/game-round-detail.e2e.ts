/**
 * E2E: GET /tenant/game-stats/rounds/:id — detalle de una ronda.
 *
 * El endpoint es read-only, pero **acepta un id arbitrario**, y eso lo hace
 * distinto del listado: sin scope, un operador que conozca (o adivine) el id de
 * una ronda podría leer la actividad de un jugador de OTRA red. Sería una fuga
 * de aislamiento entre redes independientes — LEYES **E8/P3**.
 *
 * Por eso el test que importa no es el del camino feliz sino el segundo: un
 * actor sin `game_stats.view_any` pidiendo una ronda ajena tiene que recibir
 * **404, no 403**. Un 403 confirmaría que la ronda existe, y esa confirmación
 * ya es información que no le corresponde.
 *
 * Los datos se insertan directo en DB para controlar montos, estados y el
 * payload del proveedor.
 */

import { sql } from 'drizzle-orm';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { createTestUser } from '../helpers/test-users';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

type Row = { id: string };
const rows = (r: unknown): Row[] => r as unknown as Row[];

const RUTA = '/tenant/game-stats/rounds';

describe('GET /tenant/game-stats/rounds/:id (E2E)', () => {
  let ctx: TestApp;
  let adminToken: string;
  let adminId: string;
  let gameId: string;
  let sessionId: string;
  let seq = 0;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    const me = await ctx.request
      .get('/tenant/auth/me')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    adminId = (me.body as { user: { id: string } }).user.id;

    await ctx.tenantDb.execute(
      sql`INSERT INTO games (id, code, name, category, provider_code)
          VALUES (gen_random_uuid(), 'rdetail_game', 'RDetail Test', 'slots', 'palace')
          ON CONFLICT (code) DO NOTHING`,
    );
    const g = await ctx.tenantDb.execute(
      sql`SELECT id FROM games WHERE code = 'rdetail_game' LIMIT 1`,
    );
    gameId = rows(g)[0]!.id;

    const s = await ctx.tenantDb.execute(
      sql`INSERT INTO game_sessions (id, user_id, game_id, provider_session_id)
          VALUES (gen_random_uuid(), ${adminId}, ${gameId}, 'rdetail-sess')
          RETURNING id`,
    );
    sessionId = rows(s)[0]!.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Inserta una ronda y devuelve su id interno + su id externo. */
  async function insertarRonda(
    userId: string,
    extra: { action?: string; payload?: string; autoSettledReason?: string } = {},
  ): Promise<{ id: string; externalId: string }> {
    const externalId = `rdetail-ext-${seq++}`;
    const r = await ctx.tenantDb.execute(
      sql`INSERT INTO game_rounds
            (id, session_id, user_id, game_id, round_external_id,
             bet_amount, win_amount, net_amount, status, placed_at, settled_at,
             action, payload, auto_settled_reason)
          VALUES
            (gen_random_uuid(), ${sessionId}, ${userId}, ${gameId}, ${externalId},
             '100.00', '250.00', '150.00', 'settled', now(), now(),
             ${extra.action ?? null},
             ${extra.payload ?? '{}'}::jsonb,
             ${extra.autoSettledReason ?? null})
          RETURNING id`,
    );
    return { id: rows(r)[0]!.id, externalId };
  }

  it('devuelve el detalle con los campos que el listado NO trae', async () => {
    const { id, externalId } = await insertarRonda(adminId, {
      action: 'bonus_buy',
      payload: JSON.stringify({ seed: 'abc123', reels: [1, 2, 3], multiplier: 5 }),
      autoSettledReason: 'gregmorn_stale_round',
    });

    const res = await ctx.request
      .get(`${RUTA}/${id}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    const body = res.body as {
      round: {
        roundExternalId: string;
        action: string | null;
        payload: { seed: string; multiplier: number };
        autoSettledReason: string | null;
      };
      providerTxs: unknown[];
    };

    // Lo que ya se veía.
    expect(body.round.roundExternalId).toBe(externalId);

    // Lo que NO se veía y es el motivo de este endpoint.
    expect(body.round.action).toBe('bonus_buy');
    expect(body.round.payload.seed).toBe('abc123');
    expect(body.round.payload.multiplier).toBe(5);
    expect(body.round.autoSettledReason).toBe('gregmorn_stale_round');

    // Sin filas del proveedor la ronda igual se puede abrir.
    expect(Array.isArray(body.providerTxs)).toBe(true);
  });

  it('trae la transacción del proveedor con SU id (lo que se le reclama)', async () => {
    const { id, externalId } = await insertarRonda(adminId);
    await ctx.tenantDb.execute(
      sql`INSERT INTO palace_transactions
            (id, trans_guid, user_id, account, game_code, round_id, amount,
             type, sort)
          VALUES
            (gen_random_uuid(), ${`guid-${externalId}`}, ${adminId}, 'acct1',
             'rdetail_game', ${externalId}, '100.00', 1, 'BET')`,
    );

    const res = await ctx.request
      .get(`${RUTA}/${id}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    const body = res.body as {
      providerTxs: { idLabel: string; externalId: string; kind: string | null }[];
    };
    expect(body.providerTxs).toHaveLength(1);
    expect(body.providerTxs[0]!.idLabel).toBe('trans_guid');
    expect(body.providerTxs[0]!.externalId).toBe(`guid-${externalId}`);
    // BET/WIN/CANCEL, no el código numérico del callback.
    expect(body.providerTxs[0]!.kind).toBe('BET');
  });

  it('404 —no 403— si la ronda es de otra red (E8/P3)', async () => {
    // Socio sin `game_stats.view_any`: sólo ve su propia red, y su red está
    // vacía. La ronda es del admin, así que le es ajena.
    const socio = await createTestUser(ctx.request, adminToken, {
      suite: 'round-detail',
      label: 'socio',
      role: 'socio',
    });
    const socioToken = await loginAs(
      ctx.request,
      socio.username,
      socio.password,
    );

    const { id } = await insertarRonda(adminId);

    const res = await ctx.request
      .get(`${RUTA}/${id}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken);

    // 404 y NO 403: un 403 confirmaría que la ronda existe.
    expect(res.status).toBe(404);
  });

  it('el mismo actor SÍ ve una ronda de su propia red', async () => {
    // Contraprueba del test anterior: si el socio recibiera 404 siempre, el
    // test de arriba pasaría por el motivo equivocado.
    const socio = await createTestUser(ctx.request, adminToken, {
      suite: 'round-detail',
      label: 'socio2',
      role: 'socio',
    });
    const socioToken = await loginAs(
      ctx.request,
      socio.username,
      socio.password,
    );

    const { id, externalId } = await insertarRonda(socio.id);

    const res = await ctx.request
      .get(`${RUTA}/${id}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', socioToken);

    expect(res.status).toBe(200);
    expect((res.body as { round: { roundExternalId: string } }).round
      .roundExternalId).toBe(externalId);
  });

  it('404 si el id no existe', async () => {
    const res = await ctx.request
      .get(`${RUTA}/00000000-0000-7000-8000-000000000000`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);

    expect(res.status).toBe(404);
  });
});
