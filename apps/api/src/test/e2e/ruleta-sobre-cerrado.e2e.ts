/**
 * El sobre cerrado del giro — `docs/27-ruleta-diaria.md` §8.
 *
 * Lo que se prueba no es que el mecanismo exista, sino que **sirva**: que el
 * jugador pueda rehacer la cuenta por su cuenta y le dé lo mismo que le dio al
 * servidor. Por eso los tests recalculan el HMAC a mano, sin usar el service —
 * si usaran el mismo código que están verificando, no probarían nada.
 */

import { createHash, createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';

const SUITE = `ruleta-sobre-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken = '';
let planillaId = '';
let ruletaId = '';

/**
 * La misma cuenta que hace el servidor, escrita aparte a propósito.
 * Es lo que haría el jugador con la semilla en la mano.
 */
function valorEsperado(serverSeed: string, clientSeed: string, dia: string): number {
  const hmac = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${dia}`)
    .digest('hex');
  return Number.parseInt(hmac.slice(0, 13), 16) / 2 ** 52;
}

async function jugador(label: string): Promise<string> {
  const u = await createTestUser(ctx.request, adminToken, {
    suite: SUITE,
    label,
    role: 'usuario_final',
  });
  return loginAs(ctx.request, u.username, u.password);
}

describe('ruleta diaria · el sobre cerrado', () => {
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
        name: 'Planilla',
        type: 'manual',
        status: 'active',
        expirationDays: 7,
      });
    planillaId = planilla.body.id as string;

    // Dos gajos de mitad y mitad: así el gajo que sale depende de verdad del
    // sorteo. Con un solo gajo, "verificar" no distinguiria nada.
    const creada = await ctx.request
      .post('/tenant/promotions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code: `${SUITE}_rueda`,
        name: 'Rueda verificable',
        type: 'daily_wheel',
        status: 'active',
        config: {
          segments: [
            {
              id: 'bajo',
              label: 'Bajo',
              probability: 0.5,
              prize: { kind: 'bonus', definitionId: planillaId, amount: 10 },
            },
            {
              id: 'alto',
              label: 'Alto',
              probability: 0.5,
              prize: { kind: 'bonus', definitionId: planillaId, amount: 20 },
            },
          ],
        },
      });
    expect(creada.status).toBe(201);
    ruletaId = creada.body.id as string;
  });

  afterAll(async () => {
    await ctx.close();
  });

  function compromiso(token: string, clientSeed?: string) {
    const url = clientSeed
      ? `/tenant/promotions/${ruletaId}/commitment?clientSeed=${clientSeed}`
      : `/tenant/promotions/${ruletaId}/commitment`;
    return ctx.request
      .get(url)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
  }

  function girar(token: string) {
    return ctx.request
      .post(`/tenant/promotions/${ruletaId}/spin`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
  }

  it('el compromiso da la huella y NUNCA la semilla', async () => {
    const token = await jugador('huella');
    const res = await compromiso(token, 'mi-semilla');
    expect(res.status).toBe(200);
    expect(res.body.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.clientSeed).toBe('mi-semilla');
    // Lo que no puede pasar de ninguna manera:
    expect(res.body.serverSeed).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('serverSeed"');
  });

  it('pedirlo dos veces da la MISMA huella', async () => {
    // Si cambiara, el jugador podría pedir compromisos hasta que le guste uno,
    // y el mecanismo no probaría nada.
    const token = await jugador('estable');
    const a = await compromiso(token);
    const b = await compromiso(token);
    expect(a.body.serverSeedHash).toBe(b.body.serverSeedHash);
    expect(a.body.clientSeed).toBe(b.body.clientSeed);
  });

  it('el jugador puede rehacer la cuenta y le da lo mismo', async () => {
    const token = await jugador('verifica');
    const antes = await compromiso(token, 'semilla-del-jugador');
    const huellaPrometida = antes.body.serverSeedHash as string;

    const giro = await girar(token);
    expect(giro.status).toBe(200);
    const v = giro.body.verificacion as {
      serverSeed: string;
      serverSeedHash: string;
      clientSeed: string;
      rng: number;
      configHash: string;
    };

    // 1. La semilla revelada produce la huella que se publicó ANTES.
    expect(createHash('sha256').update(v.serverSeed).digest('hex')).toBe(
      huellaPrometida,
    );
    expect(v.serverSeedHash).toBe(huellaPrometida);

    // 2. Esa semilla produce el valor del sorteo que dice el servidor.
    const esperado = valorEsperado(
      v.serverSeed,
      v.clientSeed,
      antes.body.dayAnchor as string,
    );
    expect(v.rng).toBeCloseTo(esperado, 12);

    // 3. Y ese valor corresponde al gajo que salió: con dos gajos de 0,5,
    //    menos de 0,5 es el primero.
    expect(giro.body.segmentId).toBe(esperado < 0.5 ? 'bajo' : 'alto');

    // 4. Se sabe contra qué rueda verificar (§10).
    expect(v.configHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la semilla del jugador cambia el resultado', async () => {
    // Es lo que impide que el servidor genere mil semillas y se quede con la
    // que da el peor premio: el resultado depende de algo que eligió el jugador.
    const t1 = await jugador('seed-a');
    const t2 = await jugador('seed-b');
    const c1 = await compromiso(t1, 'aaaa');
    const c2 = await compromiso(t2, 'bbbb');
    expect(c1.body.clientSeed).toBe('aaaa');
    expect(c2.body.clientSeed).toBe('bbbb');

    const g1 = await girar(t1);
    const g2 = await girar(t2);
    const v1 = g1.body.verificacion as { serverSeed: string; rng: number };
    const v2 = g2.body.verificacion as { serverSeed: string; rng: number };

    // Con la MISMA semilla de servidor pero distinta del jugador, el valor
    // tiene que cambiar. Se verifica cruzando las semillas a mano.
    const dia = c1.body.dayAnchor as string;
    expect(valorEsperado(v1.serverSeed, 'aaaa', dia)).toBeCloseTo(v1.rng, 12);
    expect(valorEsperado(v1.serverSeed, 'bbbb', dia)).not.toBeCloseTo(v1.rng, 6);
    expect(valorEsperado(v2.serverSeed, 'bbbb', dia)).toBeCloseTo(v2.rng, 12);
  });

  it('girar sin haber pedido el compromiso igual es verificable', async () => {
    // Un cliente que no pase por el endpoint previo no puede quedarse sin
    // prueba: el giro crea el compromiso si falta. Pierde la garantía de que
    // la huella es anterior —la ve recién ahora— pero el sorteo sigue siendo
    // reproducible, y la fila del compromiso queda igual.
    const token = await jugador('directo');
    const giro = await girar(token);
    expect(giro.status).toBe(200);
    const v = giro.body.verificacion as { serverSeed: string; rng: number };
    expect(v.serverSeed).toMatch(/^[0-9a-f]{64}$/);

    const filas = (await ctx.tenantDb.execute(sql`
      SELECT revealed_at FROM promotion_spin_commitments
       WHERE promotion_id = ${ruletaId}
    `)) as unknown as Array<{ revealed_at: string | null }>;
    expect(filas.some((f) => f.revealed_at !== null)).toBe(true);
  });
});
