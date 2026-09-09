/**
 * E2E: la ficha del contacto no cruza redes (LEY R6 / P1).
 *
 * ## Por qué este test es de los que más importan
 *
 * `GET /tenant/chat/contacts/:id/context` arma la ficha que el operador ve al
 * costado de la conversación: identidad, **saldo, últimos depósitos y últimos
 * retiros**.
 *
 * Hasta el 2026-09-08 devolvía todo eso **sin mirar de qué red era el jugador**.
 * No filtraba nada en la práctica porque el ruteo lo hacía inalcanzable —el
 * único canal era el widget web y las conversaciones de un jugador
 * independiente van siempre a su operador directo—, pero `D3` abre esa puerta a
 * propósito: el staff central atiende a quien le escriba al número del casino.
 *
 * **Un fallo acá no se ve: se filtra.** No rompe ninguna pantalla, no tira
 * ningún error. Simplemente el staff central empieza a ver la plata de los
 * clientes de un socio independiente, y el socio no se entera. Por eso se fija
 * con tests y no mirando.
 *
 * ## Los tres casos que cubre
 *
 *   1. **Staff central → jugador de una red independiente**: identidad y cartel
 *      de red, **sin plata**. Es R6.
 *   2. **Socio independiente → jugador de OTRA red independiente**: lo mismo. No
 *      está en `D3` pero cruza redes igual (P1), y puede pasar de verdad: por
 *      `D2` atiende quien es dueño del número, sea de la red que sea.
 *   3. **Cada uno con lo suyo**: la plata aparece completa.
 *
 * Y uno más, al revés: **jugador de la red central → socio independiente**.
 * Tampoco ve la plata.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { fundWalletForTests } from '../helpers/fund-wallet';

const SUITE = `crm-r6-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken: string;
let adminId = '';

/** Los dos socios independientes y sus jugadores, más uno de la red central. */
let litoral: TestUser;
let costa: TestUser;
let jugadorLitoral: TestUser;
let jugadorCosta: TestUser;
let jugadorCentral: TestUser;

/** Contactos del CRM, uno por jugador. */
const contacto: Record<string, string> = {};

async function marcarIndependiente(userId: string): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE users SET is_independent_branch = true WHERE id = ${userId}`,
  );
}

/** Cuelga a `hijo` de `padre` en la jerarquía (reemplaza el vínculo activo). */
async function colgarDe(hijo: string, padre: string): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE user_hierarchy SET until = now()
         WHERE user_id = ${hijo} AND until IS NULL`,
  );
  // El `id` de `user_hierarchy` se genera en la APLICACIÓN
  // (`$defaultFn(generateUuidV7)`), no en la DB: un INSERT crudo tiene que
  // traerlo. Con drizzle no se nota; escribiendo SQL a mano, sí.
  await ctx.tenantDb.execute(
    sql`INSERT INTO user_hierarchy (id, user_id, parent_user_id, relation_type)
        VALUES (gen_random_uuid(), ${hijo}, ${padre}, 'jugador_de_socio')`,
  );
}

/**
 * Crea el contacto del CRM para un jugador y una conversación asignada a
 * `atiende`, que es lo que hace que `assertAccess` deje pasar. Sin esto el
 * endpoint devolvería 403 y el test no probaría nada de lo que quiere probar.
 */
async function contactoConConversacion(
  jugadorId: string,
  atiende: string,
): Promise<string> {
  const canal = await ctx.tenantDb.execute(
    sql`INSERT INTO crm_channels (type) VALUES ('web-livechat') RETURNING id`,
  );
  const canalId = (canal as unknown as Array<{ id: string }>)[0]!.id;

  const c = await ctx.tenantDb.execute(
    sql`INSERT INTO crm_contacts (user_id, display_name, is_lead)
        VALUES (${jugadorId}, 'Test', false) RETURNING id`,
  );
  const contactId = (c as unknown as Array<{ id: string }>)[0]!.id;

  await ctx.tenantDb.execute(
    sql`INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id)
        VALUES (${contactId}, ${canalId}, ${atiende})`,
  );
  return contactId;
}

interface Ficha {
  identity: { username: string } | null;
  wallet: { balance: string } | null;
  upline: unknown | null;
  recentDeposits: unknown[];
  recentWithdrawals: unknown[];
  network: { same: boolean; label: string | null } | null;
}

async function ficha(contactId: string, bearer: string): Promise<Ficha> {
  const res = await ctx.request
    .get(`/tenant/chat/contacts/${contactId}/context`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer);
  if (res.status !== 200) {
    throw new Error(`context devolvió ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body as Ficha;
}

describe('CRM · la ficha del contacto no cruza redes (R6 / P1)', () => {
  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    const admin = await ctx.tenantDb.execute(
      sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
    );
    adminId = (admin as unknown as Array<{ id: string }>)[0]!.id;

    // Dos redes independientes distintas.
    litoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'litoral', role: 'socio',
    });
    costa = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'costa', role: 'socio',
    });
    await marcarIndependiente(litoral.id);
    await marcarIndependiente(costa.id);

    // Un jugador en cada una, y uno de la red central.
    jugadorLitoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'jugliv', role: 'usuario_final',
    });
    jugadorCosta = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'jugcos', role: 'usuario_final',
    });
    jugadorCentral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'jugcen', role: 'usuario_final',
    });
    await colgarDe(jugadorLitoral.id, litoral.id);
    await colgarDe(jugadorCosta.id, costa.id);

    // Plata de verdad en las tres wallets. Sin esto `wallet` vendría null por
    // no existir la fila, y los tests de "sí ve lo suyo" pasarían por el
    // motivo equivocado: parecerían verificar el filtro cuando en realidad no
    // habría nada que filtrar.
    await Promise.all([
      fundWalletForTests(jugadorLitoral.id, '1500.00'),
      fundWalletForTests(jugadorCosta.id, '2500.00'),
      fundWalletForTests(jugadorCentral.id, '3500.00'),
    ]);

    // Las conversaciones que dan acceso. El staff central atiende por la
    // bandeja del admin principal; Litoral, por la suya.
    contacto.litoralVistoPorCentral = await contactoConConversacion(
      jugadorLitoral.id, adminId,
    );
    contacto.costaVistoPorLitoral = await contactoConConversacion(
      jugadorCosta.id, litoral.id,
    );
    contacto.centralVistoPorLitoral = await contactoConConversacion(
      jugadorCentral.id, litoral.id,
    );
    contacto.litoralVistoPorLitoral = await contactoConConversacion(
      jugadorLitoral.id, litoral.id,
    );
    contacto.centralVistoPorCentral = await contactoConConversacion(
      jugadorCentral.id, adminId,
    );
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  describe('lo que NO puede ver', () => {
    it('el staff central no ve la plata de un jugador de una red independiente', async () => {
      const f = await ficha(contacto.litoralVistoPorCentral!, adminToken);

      expect(f.wallet).toBeNull();
      expect(f.recentDeposits).toEqual([]);
      expect(f.recentWithdrawals).toEqual([]);
      // Tampoco de qué operador cuelga: el cartel ya dice la red, y el
      // operador concreto es detalle interno de esa red.
      expect(f.upline).toBeNull();
    });

    it('pero sí ve quién es y de qué red viene, para poder atenderlo (D3)', async () => {
      const f = await ficha(contacto.litoralVistoPorCentral!, adminToken);

      expect(f.identity?.username).toBe(jugadorLitoral.username);
      expect(f.network?.same).toBe(false);
      // El cartel: "este jugador es de la red de <socio>".
      expect(f.network?.label).toBeTruthy();
    });

    it('un socio independiente no ve la plata de un jugador de OTRA red independiente', async () => {
      const bearer = await loginAs(ctx.request, litoral.username, litoral.password);
      const f = await ficha(contacto.costaVistoPorLitoral!, bearer);

      expect(f.network?.same).toBe(false);
      expect(f.wallet).toBeNull();
      expect(f.recentDeposits).toEqual([]);
      expect(f.recentWithdrawals).toEqual([]);
    });

    it('y tampoco la de un jugador de la red central', async () => {
      const bearer = await loginAs(ctx.request, litoral.username, litoral.password);
      const f = await ficha(contacto.centralVistoPorLitoral!, bearer);

      expect(f.network?.same).toBe(false);
      expect(f.wallet).toBeNull();
      // No se le nombra la red del casino: no hay nada que aclararle.
      expect(f.network?.label).toBeNull();
    });
  });

  describe('lo que SÍ ve, cada uno de lo suyo', () => {
    it('el socio independiente ve completa la ficha de SU jugador', async () => {
      const bearer = await loginAs(ctx.request, litoral.username, litoral.password);
      const f = await ficha(contacto.litoralVistoPorLitoral!, bearer);

      expect(f.network?.same).toBe(true);
      expect(f.wallet?.balance).toBe('1500.00');
      expect(f.identity?.username).toBe(jugadorLitoral.username);
    });

    it('el staff central ve completa la de un jugador de su propia red', async () => {
      const f = await ficha(contacto.centralVistoPorCentral!, adminToken);

      expect(f.network?.same).toBe(true);
      expect(f.wallet?.balance).toBe('3500.00');
    });
  });
});
