/**
 * Quién puede girar la ruleta diaria — `docs/27-ruleta-diaria.md` §3.
 *
 * Los cuatro casos que este archivo cubre **estaban todos abiertos** hasta el
 * 2026-09-10: el endpoint de giro pedía sólo sesión y no miraba nada más.
 *
 * El que más importa es el de la red independiente. No es una preferencia de
 * producto: los premios los paga la Casa, y dárselos a un jugador que cuelga de
 * una sub-red independiente es que un actor externo fondee esa red — LEY **E8**.
 * Se prueba por los dos caminos, listado y giro, porque **tienen que dar la
 * misma respuesta**: si sólo se filtrara el listado, un `curl` alcanzaría.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';

const SUITE = `ruleta-eleg-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken = '';
let ruletaId = '';

/** Jugador de la red central: cuelga del admin, que es lo que da por default. */
let jugadorCentral: TestUser;
let tokenCentral = '';

/** Socio independiente y un jugador colgado de él. */
let socioIndependiente: TestUser;
let jugadorIndependiente: TestUser;
let tokenIndependiente = '';

/** Un cajero, para probar que un operador no gira. */
let cajero: TestUser;
let tokenCajero = '';

/** Jugador que se va a suspender. */
let jugadorSuspendido: TestUser;
let tokenSuspendido = '';

async function colgarDe(hijo: string, padre: string, rel: string): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE user_hierarchy SET until = now()
         WHERE user_id = ${hijo} AND until IS NULL`,
  );
  await ctx.tenantDb.execute(
    sql`INSERT INTO user_hierarchy (id, user_id, parent_user_id, relation_type)
        VALUES (gen_random_uuid(), ${hijo}, ${padre}, ${rel})`,
  );
}

async function crearJugador(label: string): Promise<{ u: TestUser; token: string }> {
  const u = await createTestUser(ctx.request, adminToken, {
    suite: SUITE,
    label,
    role: 'usuario_final',
  });
  const token = await loginAs(ctx.request, u.username, u.password);
  return { u, token };
}

function girar(token: string) {
  return ctx.request
    .post(`/tenant/promotions/${ruletaId}/spin`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token);
}

function listarRuletas(token: string) {
  return ctx.request
    .get('/tenant/promotions/active?type=daily_wheel')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token);
}

describe('ruleta diaria · quién puede girar', () => {
  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    // El funder de la promo es el admin, y `resetMutableState()` trunca
    // `wallets`. Sin esto el giro del caso feliz muere con
    // FUNDER_INSUFFICIENT_BALANCE y los 403 de abajo no probarían nada —
    // estarían pasando por el motivo equivocado.
    const adminRow = (await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
    )) as unknown as Array<{ id: string }>;
    await fundWalletForTests(adminRow[0]!.id, '1000000');

    // Una ruleta activa que siempre da el mismo premio: lo que se prueba acá
    // es quién puede girar, no qué sale.
    const res = await ctx.request
      .post('/tenant/promotions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code: `ruleta_eleg_${Date.now()}`,
        name: 'Ruleta de elegibilidad',
        type: 'daily_wheel',
        status: 'active',
        config: {
          segments: [
            {
              id: 'unico',
              label: '10 fichas',
              probability: 1.0,
              prize: { kind: 'chips', amount: 10 },
            },
          ],
        },
      });
    expect(res.status).toBe(201);
    ruletaId = res.body.id as string;

    // Red central.
    ({ u: jugadorCentral, token: tokenCentral } = await crearJugador('central'));

    // Red independiente: socio con el flag + un jugador colgado de él.
    socioIndependiente = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'socioind',
      role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true
           WHERE id = ${socioIndependiente.id}`,
    );
    ({ u: jugadorIndependiente, token: tokenIndependiente } =
      await crearJugador('jugind'));
    await colgarDe(jugadorIndependiente.id, socioIndependiente.id, 'usuario_final');

    // Un operador.
    cajero = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'cajero',
      role: 'cajero',
    });
    tokenCajero = await loginAs(ctx.request, cajero.username, cajero.password);

    // Un jugador al que después se le suspende la cuenta.
    ({ u: jugadorSuspendido, token: tokenSuspendido } =
      await crearJugador('suspendido'));
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ──────────────────────────────────────────────────────────────────────
  // El caso feliz, que es el que sostiene a los demás: si esto no pasa, los
  // 403 de abajo podrían estar dando por cualquier otro motivo.
  // ──────────────────────────────────────────────────────────────────────

  it('un jugador de la red central gira y ve la ruleta', async () => {
    const listado = await listarRuletas(tokenCentral);
    expect(listado.status).toBe(200);
    expect((listado.body.data as { id: string }[]).map((p) => p.id)).toContain(
      ruletaId,
    );

    const giro = await girar(tokenCentral);
    expect(giro.status).toBe(200);
    expect(giro.body.segmentId).toBe('unico');
  });

  // ──────────────────────────────────────────────────────────────────────
  // LEY E8 — la que más importa
  // ──────────────────────────────────────────────────────────────────────

  describe('red independiente (E8)', () => {
    it('no ve la ruleta en el listado', async () => {
      const res = await listarRuletas(tokenIndependiente);
      expect(res.status).toBe(200);
      expect((res.body.data as { id: string }[]).map((p) => p.id)).not.toContain(
        ruletaId,
      );
    });

    it('tampoco puede girar yendo derecho al endpoint', async () => {
      // Es el test que de verdad importa: esconder el botón no es una defensa.
      const res = await girar(tokenIndependiente);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('WHEEL_NOT_FOR_YOUR_NETWORK');
    });

    it('y no le quedó ningún premio registrado', async () => {
      const filas = (await ctx.tenantDb.execute(
        sql`SELECT count(*)::int AS n FROM promotion_rewards
             WHERE promotion_id = ${ruletaId}
               AND user_id = ${jugadorIndependiente.id}`,
      )) as unknown as Array<{ n: number }>;
      expect(filas[0]!.n).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Operadores
  // ──────────────────────────────────────────────────────────────────────

  it('un cajero no puede girar', async () => {
    const res = await girar(tokenCajero);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WHEEL_NOT_A_PLAYER');
  });

  it('el admin tampoco', async () => {
    const res = await girar(adminToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WHEEL_NOT_A_PLAYER');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Estado de la cuenta
  // ──────────────────────────────────────────────────────────────────────

  it('una cuenta suspendida no gira', async () => {
    await ctx.tenantDb.execute(
      sql`UPDATE users SET status = 'suspended' WHERE id = ${jugadorSuspendido.id}`,
    );
    const res = await girar(tokenSuspendido);

    // **401, no 403.** La sesión se cae antes de llegar a la ruleta:
    // `TenantAuthService` invalida el token de cualquier usuario que no esté
    // `active`. O sea que `WheelAccountNotActiveError` es, por HTTP,
    // inalcanzable — queda como segunda defensa para cualquier otro camino que
    // llame al service sin pasar por el guard.
    //
    // Se afirma lo que pasa y no lo que uno esperaría: un test que espera 403
    // acá estaría describiendo un sistema que no existe.
    expect(res.status).toBe(401);

    // Lo que de verdad importa: no giró y no se llevó nada.
    const filas = (await ctx.tenantDb.execute(
      sql`SELECT count(*)::int AS n FROM promotion_rewards
           WHERE promotion_id = ${ruletaId} AND user_id = ${jugadorSuspendido.id}`,
    )) as unknown as Array<{ n: number }>;
    expect(filas[0]!.n).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Juego responsable
  // ──────────────────────────────────────────────────────────────────────

  it('un autoexcluido no gira, aunque no haya girado hoy', async () => {
    // El login se hace ANTES de cargar la exclusión: `TenantAuthService.login`
    // rechaza a quien tiene una activa, así que al revés no habría token con
    // el que probar el freno de la ruleta.
    const { u, token } = await crearJugador('autoexcl');
    // Se carga por SQL a propósito: lo que se prueba es el freno de la ruleta,
    // no el endpoint de juego responsable.
    await ctx.tenantDb.execute(
      sql`INSERT INTO self_exclusions
            (id, user_id, type, status, starts_at, ends_at, reason)
          VALUES (gen_random_uuid(), ${u.id}, 'temporary', 'active', now(),
                  now() + interval '30 days', 'test')`,
    );
    const res = await girar(token);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WHEEL_SELF_EXCLUDED');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Tiradas gratis — no se pueden ni configurar (docs/27 §15)
  // ──────────────────────────────────────────────────────────────────────

  describe('tiradas gratis bloqueadas', () => {
    const configConFreeSpins = {
      segments: [
        {
          id: 'gratis',
          label: '10 giros gratis',
          probability: 1.0,
          prize: { kind: 'free_spins', count: 10 },
        },
      ],
    };

    it('no se puede crear una ruleta con un segmento de tiradas gratis', async () => {
      const res = await ctx.request
        .post('/tenant/promotions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `ruleta_fs_${Date.now()}`,
          name: 'Con tiradas gratis',
          type: 'daily_wheel',
          status: 'draft',
          config: configConFreeSpins,
        });
      // No importa el código exacto mientras NO se haya creado: lo que no
      // puede pasar es un 201.
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('tampoco se puede editar una existente para agregarlo', async () => {
      const res = await ctx.request
        .patch(`/tenant/promotions/${ruletaId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ config: configConFreeSpins });
      expect(res.status).toBeGreaterThanOrEqual(400);

      // Y la config vieja quedó intacta.
      const detalle = await ctx.request
        .get(`/tenant/promotions/${ruletaId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken);
      expect(detalle.status).toBe(200);
      const segments = (detalle.body.config as { segments: { id: string }[] })
        .segments;
      expect(segments.map((s) => s.id)).toEqual(['unico']);
    });
  });
});
