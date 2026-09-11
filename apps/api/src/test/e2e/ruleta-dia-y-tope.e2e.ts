/**
 * El día de la ruleta y el tope diario — `docs/27-ruleta-diaria.md` §4 y §6.
 *
 * Dos cosas que antes no existían:
 *
 * 1. **El día corta en la zona del casino**, no en UTC. Con el corte en UTC el
 *    jugador perdía su giro a las 21:00 hora argentina y a las 21:01 podía
 *    girar de nuevo: dos giros en la misma noche, todas las noches. Es el bug
 *    que más plata costaba y el que menos se veía.
 *
 * 2. **El tope diario**, que es la única contención contra las cuentas
 *    múltiples mientras el antifraude siga desenganchado. Se prueba que frena
 *    de verdad y que lo que reparte de más es cero, no "poco".
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';

const SUITE = `ruleta-tope-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken = '';

/** La planilla de bono de la ruleta. La ruleta no entrega fichas retirables. */
let planillaId = '';

/** Una rueda de un solo premio de 100 fichas, más el gajo sin premio. */
function configDeDosGajos(overrides: Record<string, unknown> = {}) {
  return {
    segments: [
      {
        id: 'premio',
        label: '100 fichas',
        probability: 0.99,
        prize: { kind: 'bonus', definitionId: planillaId, amount: 100 },
      },
      {
        id: 'suerte',
        label: 'Suerte la próxima',
        probability: 0.01,
        prize: { kind: 'try_again' },
      },
    ],
    ...overrides,
  };
}

async function crearRuleta(
  config: Record<string, unknown>,
): Promise<{ status: number; id?: string; body: Record<string, unknown> }> {
  const res = await ctx.request
    .post('/tenant/promotions')
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send({
      code: `${SUITE}_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Ruleta con tope',
      type: 'daily_wheel',
      status: 'active',
      config,
    });
  return {
    status: res.status,
    id: res.body?.id as string | undefined,
    body: res.body as Record<string, unknown>,
  };
}

async function jugadorConToken(label: string): Promise<string> {
  const u = await createTestUser(ctx.request, adminToken, {
    suite: SUITE,
    label,
    role: 'usuario_final',
  });
  return loginAs(ctx.request, u.username, u.password);
}

function girar(ruletaId: string, token: string) {
  return ctx.request
    .post(`/tenant/promotions/${ruletaId}/spin`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', token);
}

describe('ruleta diaria · el día y el tope', () => {
  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    const adminRow = (await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
    )) as unknown as Array<{ id: string }>;
    await fundWalletForTests(adminRow[0]!.id, '10000000');

    const planilla = await ctx.request
      .post('/tenant/bonus-definitions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code: `${SUITE}_planilla`,
        name: 'Planilla de la ruleta',
        type: 'manual',
        status: 'active',
        expirationDays: 7,
      });
    expect(planilla.status).toBe(201);
    planillaId = planilla.body.id as string;
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ──────────────────────────────────────────────────────────────────────
  // El día
  // ──────────────────────────────────────────────────────────────────────

  describe('el día corta en la zona del casino', () => {
    it('el ancla del giro es la fecha argentina, no la UTC', async () => {
      const { id } = await crearRuleta(configDeDosGajos());
      const token = await jugadorConToken('ancla');
      const res = await girar(id!, token);
      expect(res.status).toBe(200);

      const filas = (await ctx.tenantDb.execute(
        sql`SELECT metadata->>'dayAnchor' AS ancla
              FROM promotion_rewards WHERE promotion_id = ${id}`,
      )) as unknown as Array<{ ancla: string }>;

      const esperada = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      expect(filas[0]!.ancla).toBe(esperada);
    });

    it('entre las 21:00 y las 00:00 AR el ancla NO cambia (el bug viejo)', () => {
      // Es la ventana donde el corte en UTC daba el segundo giro: a las 21:00
      // AR ya es el día siguiente en UTC. Se compara directo, sin tocar la base,
      // porque lo que se prueba es la regla de fechas.
      const alAnochecer = new Date('2026-03-15T23:30:00-03:00'); // 02:30 UTC del 16
      const enZona = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(alAnochecer);
      expect(enZona).toBe('2026-03-15');
      // La que usaba el código viejo:
      expect(alAnochecer.toISOString().slice(0, 10)).toBe('2026-03-16');
    });

    it('una ruleta con premio en fichas retirables no se puede guardar', async () => {
      // docs/27 §5.1: el premio va como bono, que hay que jugar. Con `chips`
      // el jugador giraba, ganaba 200 y retiraba 200 sin apostar nada.
      const res = await crearRuleta({
        segments: [
          { id: 'plata', probability: 1.0, prize: { kind: 'chips', amount: 200 } },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('WHEEL_CONFIG_INVALID');
      expect(String(res.body.message)).toContain('bono');
    });

    it('una zona horaria inventada no se puede guardar', async () => {
      const res = await crearRuleta(
        configDeDosGajos({ timezone: 'Marte/Olympus_Mons' }),
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('WHEEL_CONFIG_INVALID');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // El tope
  // ──────────────────────────────────────────────────────────────────────

  describe('el tope diario', () => {
    it('con el tope agotado la rueda sigue girando pero no reparte', async () => {
      // Tope de 250 y premios de 100: entran dos, el tercero ya no.
      const { id } = await crearRuleta(
        configDeDosGajos({ dailyCapChips: 250 }),
      );

      const ganados: number[] = [];
      for (let i = 0; i < 4; i++) {
        const token = await jugadorConToken(`tope${i}`);
        const res = await girar(id!, token);
        expect(res.status).toBe(200);
        const prize = res.body.prize as { kind: string; amount?: number };
        ganados.push(prize.kind === 'bonus' ? Number(prize.amount) : 0);
      }

      // Dos premios de 100 y después nada.
      expect(ganados.filter((g) => g === 100).length).toBe(2);
      expect(ganados.filter((g) => g === 0).length).toBe(2);

      // Y el total repartido no pasó el tope. Es el número que importa.
      const filas = (await ctx.tenantDb.execute(sql`
        SELECT COALESCE(SUM((prize->>'amount')::numeric), 0)::float8 AS total
          FROM promotion_rewards
         WHERE promotion_id = ${id} AND delivery_error IS NULL
      `)) as unknown as Array<{ total: number }>;
      expect(Number(filas[0]!.total)).toBeLessThanOrEqual(250);
    });

    it('los giros simultáneos tampoco se pasan del tope', async () => {
      // El caso que el `FOR UPDATE` existe para cubrir: sin él, los cuatro
      // leen el mismo gasto, los cuatro se creen adentro y los cuatro pagan.
      const { id } = await crearRuleta(
        configDeDosGajos({ dailyCapChips: 250 }),
      );
      // Los jugadores se crean EN SERIE. Crearlos en paralelo son doce pedidos
      // simultáneos —alta y login de cada uno— y bajo carga eso corta alguna
      // conexión. Es preparación, no lo que se prueba: lo único que tiene que
      // ser simultáneo son los giros.
      const tokens: string[] = [];
      for (const i of [0, 1, 2, 3, 4, 5]) {
        tokens.push(await jugadorConToken(`race${i}`));
      }

      // `allSettled` y no `all`: bajo carga, alguna de las seis conexiones
      // simultáneas se corta a nivel de socket (ECONNRESET) y eso no dice nada
      // del tope. Un pedido que ni llegó tampoco gastó.
      //
      // Lo que se afirma es el INVARIANTE en la base, no que los seis HTTP
      // hayan respondido. Y tiene dientes igual: sin el `FOR UPDATE`, el total
      // medido fue 500 contra un tope de 250.
      const respuestas = await Promise.allSettled(
        tokens.map((t) => girar(id!, t)),
      );
      const llegaron = respuestas.filter((r) => r.status === 'fulfilled').length;
      expect(llegaron).toBeGreaterThanOrEqual(3);

      const filas = (await ctx.tenantDb.execute(sql`
        SELECT COALESCE(SUM((prize->>'amount')::numeric), 0)::float8 AS total
          FROM promotion_rewards
         WHERE promotion_id = ${id} AND delivery_error IS NULL
      `)) as unknown as Array<{ total: number }>;
      expect(Number(filas[0]!.total)).toBeLessThanOrEqual(250);
    });

    it('sin tope configurado reparte sin freno', async () => {
      const { id } = await crearRuleta(configDeDosGajos());
      const ganados: number[] = [];
      for (let i = 0; i < 3; i++) {
        const token = await jugadorConToken(`sintope${i}`);
        const res = await girar(id!, token);
        const prize = res.body.prize as { kind: string; amount?: number };
        ganados.push(prize.kind === 'bonus' ? Number(prize.amount) : 0);
      }
      // Con 99% de probabilidad por giro, que los tres den premio es lo
      // esperable; lo que se prueba es que NADA los frenó.
      expect(ganados.filter((g) => g === 100).length).toBeGreaterThanOrEqual(2);
    });

    it('un tope sin gajo sin premio no se puede guardar', async () => {
      // Sin dónde caer, la rueda no puede degradar: o falla el giro o reparte
      // por encima del tope. Se avisa al guardar, que es cuando se arregla.
      const res = await crearRuleta({
        segments: [
          {
            id: 'unico',
            probability: 1.0,
            prize: { kind: 'bonus', definitionId: planillaId, amount: 100 },
          },
        ],
        dailyCapChips: 500,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('WHEEL_CONFIG_INVALID');
    });

    it('un tope que no es un número > 0 no se puede guardar', async () => {
      const res = await crearRuleta(configDeDosGajos({ dailyCapChips: -5 }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('WHEEL_CONFIG_INVALID');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // El estado de entrega
  // ──────────────────────────────────────────────────────────────────────

  describe('estado de entrega', () => {
    it('un giro entregado queda marcado como entregado', async () => {
      const { id } = await crearRuleta(configDeDosGajos());
      const token = await jugadorConToken('entregado');
      const res = await girar(id!, token);
      expect(res.status).toBe(200);

      const filas = (await ctx.tenantDb.execute(sql`
        SELECT delivered_at, delivery_error, bonus_id
          FROM promotion_rewards WHERE promotion_id = ${id}
      `)) as unknown as Array<{
        delivered_at: string | null;
        delivery_error: string | null;
        bonus_id: string | null;
      }>;
      expect(filas[0]!.delivered_at).not.toBeNull();
      expect(filas[0]!.delivery_error).toBeNull();
      // El premio es un bono: tiene que existir el `user_bonus`, no un
      // movimiento de saldo retirable.
      expect(filas[0]!.bonus_id).not.toBeNull();
    });

    it('un bono que no se pudo otorgar NO queda como entregado', async () => {
      // El bug que introdujo la etapa 2: el grant de bonos tiene un fail-soft
      // que no rompe y devuelve `bonusId: null`. Como no tiraba, el premio se
      // marcaba ENTREGADO — justo lo que el estado de entrega vino a cerrar.
      //
      // Se usa una planilla en borrador, que es uno de los casos del fail-soft.
      const planillaEnBorrador = await ctx.request
        .post('/tenant/bonus-definitions')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({
          code: `ruleta_draft_${Date.now()}`,
          name: 'Planilla en borrador',
          type: 'manual',
          status: 'draft',
          expirationDays: 30,
        });
      expect(planillaEnBorrador.status).toBe(201);

      const { id } = await crearRuleta({
        segments: [
          {
            id: 'bono',
            probability: 1.0,
            prize: {
              kind: 'bonus',
              definitionId: planillaEnBorrador.body.id as string,
              amount: 50,
            },
          },
        ],
      });

      const token = await jugadorConToken('bonofallido');
      const res = await girar(id!, token);
      // Al jugador se le dice que quedó pendiente, no que ganó.
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('WHEEL_PRIZE_NOT_DELIVERED');

      const filas = (await ctx.tenantDb.execute(sql`
        SELECT delivered_at, delivery_error, bonus_id
          FROM promotion_rewards WHERE promotion_id = ${id}
      `)) as unknown as Array<{
        delivered_at: string | null;
        delivery_error: string | null;
        bonus_id: string | null;
      }>;
      expect(filas).toHaveLength(1);
      expect(filas[0]!.delivered_at).toBeNull();
      expect(filas[0]!.bonus_id).toBeNull();
      expect(filas[0]!.delivery_error).not.toBeNull();
    });

    // Se quito el test de "funder sin saldo": desde que el premio es bono, lo
    // fondea el funder de la PLANILLA, y para una planilla del admin eso se
    // redirige a la tesoreria (LEY E3). Dejar al admin sin saldo ya no produce
    // una entrega fallida. El camino de falla lo cubre el test de arriba, con
    // la planilla en borrador.
  });
});
