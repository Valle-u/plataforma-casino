/**
 * Con qué rueda se jugó cada giro — `docs/27-ruleta-diaria.md` §10.
 *
 * El agujero que cierra: la config de la rueda es mutable y el admin la edita
 * con gente girando. Los giros guardaban sólo el `segmentId`, así que al
 * cambiar la config quedaban apuntando a un gajo que ya no existía y el código
 * devolvía uno sintético. El historial se degradaba solo, en silencio, cada vez
 * que alguien tocaba la rueda.
 *
 * Lo que se perdía no es cosmético: es la única respuesta posible a *"¿qué
 * probabilidades regían el día que este jugador no ganó nunca?"*.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';

const SUITE = `ruleta-ver-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken = '';
let planillaId = '';

function rueda(labelDelPremio: string) {
  return {
    segments: [
      {
        id: 'premio',
        label: labelDelPremio,
        probability: 1.0,
        prize: { kind: 'bonus', definitionId: planillaId, amount: 100 },
      },
    ],
  };
}

describe('ruleta diaria · con qué rueda se jugó', () => {
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

  it('el giro guarda la huella y la rueda queda archivada', async () => {
    const creada = await ctx.request
      .post('/tenant/promotions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code: `${SUITE}_a`,
        name: 'Rueda versionada',
        type: 'daily_wheel',
        status: 'active',
        config: rueda('Premio viejo'),
      });
    expect(creada.status).toBe(201);
    const ruletaId = creada.body.id as string;

    const u = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'p1',
      role: 'usuario_final',
    });
    const token = await loginAs(ctx.request, u.username, u.password);
    const giro = await ctx.request
      .post(`/tenant/promotions/${ruletaId}/spin`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
    expect(giro.status).toBe(200);

    const filas = (await ctx.tenantDb.execute(sql`
      SELECT r.config_hash,
             s.config->'segments'->0->>'label' AS label_archivado
        FROM promotion_rewards r
        LEFT JOIN promotion_config_snapshots s
               ON s.promotion_id = r.promotion_id
              AND s.config_hash = r.config_hash
       WHERE r.promotion_id = ${ruletaId}
    `)) as unknown as Array<{
      config_hash: string | null;
      label_archivado: string | null;
    }>;

    expect(filas).toHaveLength(1);
    expect(filas[0]!.config_hash).not.toBeNull();
    // La rueda quedó archivada y se puede leer desde el giro.
    expect(filas[0]!.label_archivado).toBe('Premio viejo');
  });

  it('editar la rueda no reescribe el pasado', async () => {
    const creada = await ctx.request
      .post('/tenant/promotions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code: `${SUITE}_b`,
        name: 'Rueda que se edita',
        type: 'daily_wheel',
        status: 'active',
        config: rueda('Antes'),
      });
    const ruletaId = creada.body.id as string;

    const u = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'p2',
      role: 'usuario_final',
    });
    const token = await loginAs(ctx.request, u.username, u.password);
    await ctx.request
      .post(`/tenant/promotions/${ruletaId}/spin`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);

    // El admin edita la rueda DESPUÉS del giro.
    const editada = await ctx.request
      .patch(`/tenant/promotions/${ruletaId}`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({ config: rueda('Después') });
    expect(editada.status).toBe(200);

    // El giro viejo sigue apuntando a la rueda con la que se jugó.
    const filas = (await ctx.tenantDb.execute(sql`
      SELECT s.config->'segments'->0->>'label' AS label_archivado
        FROM promotion_rewards r
        JOIN promotion_config_snapshots s
          ON s.promotion_id = r.promotion_id
         AND s.config_hash = r.config_hash
       WHERE r.promotion_id = ${ruletaId}
    `)) as unknown as Array<{ label_archivado: string }>;
    expect(filas).toHaveLength(1);
    expect(filas[0]!.label_archivado).toBe('Antes');

    // Y el segundo giro del mismo día —que devuelve el premio ya dado— lo
    // resuelve contra la rueda vieja, no contra la nueva. Antes de esto,
    // devolvía un gajo sintético inventado.
    const reGiro = await ctx.request
      .post(`/tenant/promotions/${ruletaId}/spin`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', token);
    expect(reGiro.status).toBe(200);
    expect(reGiro.body.segmentLabel).toBe('Antes');
  });

  it('volver a la config anterior no crea una versión nueva', async () => {
    // Es la propiedad de identificar por contenido y no por un contador:
    // la misma rueda es la misma rueda.
    const creada = await ctx.request
      .post('/tenant/promotions')
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken)
      .send({
        code: `${SUITE}_c`,
        name: 'Rueda ida y vuelta',
        type: 'daily_wheel',
        status: 'active',
        config: rueda('Original'),
      });
    const ruletaId = creada.body.id as string;

    for (const [i, label] of ['Original', 'Cambiada', 'Original'].entries()) {
      await ctx.request
        .patch(`/tenant/promotions/${ruletaId}`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', adminToken)
        .send({ config: rueda(label) });

      const u = await createTestUser(ctx.request, adminToken, {
        suite: SUITE,
        label: `vuelta${i}`,
        role: 'usuario_final',
      });
      const token = await loginAs(ctx.request, u.username, u.password);
      await ctx.request
        .post(`/tenant/promotions/${ruletaId}/spin`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', token);
    }

    // Tres giros, tres configs guardadas... pero sólo DOS distintas.
    const filas = (await ctx.tenantDb.execute(sql`
      SELECT count(*)::int AS n FROM promotion_config_snapshots
       WHERE promotion_id = ${ruletaId}
    `)) as unknown as Array<{ n: number }>;
    expect(filas[0]!.n).toBe(2);
  });
});
