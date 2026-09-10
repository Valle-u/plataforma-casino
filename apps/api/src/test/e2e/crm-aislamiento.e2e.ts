/**
 * E2E: los dos aislamientos que el CRM ya cumplía, fijados con tests.
 *
 * Estos no arreglan nada: **fijan que siga siendo cierto**. Son los dos casos
 * de la lista de `docs/crm/08-permisos.md` que verificaban comportamiento
 * existente en vez de código nuevo.
 *
 *   4. Un operador de la red **dependiente** recibe 403 en todo el CRM.
 *   5. Un socio independiente **no ve** ninguna conversación de sus cajeros.
 *
 * ## Por qué merecen tests aunque ya funcionen
 *
 * Un fallo acá **no se ve: se filtra**. No rompe ninguna pantalla ni tira un
 * error — simplemente aparecen conversaciones donde no corresponde. Y las dos
 * reglas dependen de una sola función (`resolveInboxOwner`), así que un cambio
 * bienintencionado ahí las rompe a las dos de una.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin, loginAsCajero1 } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { ChatCrmService } from '../../chat/chat-crm.service';
import { ChatService } from '../../chat/chat.service';
import { CrmNetworkService } from '../../chat/crm-network.service';

const SUITE = `crm-aisl-${Date.now().toString(36)}`;
const UUID = '00000000-0000-4000-8000-000000000001';

let ctx: TestApp;
let adminToken: string;
let adminId = '';
let canalId = '';

/** Red independiente: Litoral → su cajero → un jugador del cajero. */
let litoral: TestUser;
let cajeroDeLitoral: TestUser;
let jugadorDelCajero: TestUser;

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

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

describe('CRM · aislamiento entre redes', () => {
  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);

    adminId = (
      await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT id FROM users WHERE username = ${TEST_TENANT.admin.username}`,
        ),
      )
    ).id;
    canalId = (
      await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`INSERT INTO crm_channels (type) VALUES ('web-livechat') RETURNING id`,
        ),
      )
    ).id;

    litoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'litoral', role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${litoral.id}`,
    );
    cajeroDeLitoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'cajlit', role: 'cajero',
    });
    jugadorDelCajero = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'jugcaj', role: 'usuario_final',
    });
    await colgarDe(cajeroDeLitoral.id, litoral.id, 'cajero_de_socio');
    await colgarDe(jugadorDelCajero.id, cajeroDeLitoral.id, 'jugador_de_cajero');
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  // ── 4 · La red dependiente no entra al CRM ────────────────────────────────

  describe('un operador de la red dependiente no entra al CRM', () => {
    let cajeroToken = '';

    beforeAll(async () => {
      // `cajero1` del seed cuelga del admin: red dependiente.
      cajeroToken = await loginAsCajero1(ctx.request);
    });

    /**
     * Todas las rutas del CRM, una por una.
     *
     * ⚠️ **Si se agrega un endpoint al CRM, va en esta lista.** El guard está a
     * nivel de clase, así que en la práctica queda cubierto solo — pero esta
     * lista es lo que lo demuestra, y un endpoint nuevo en OTRO controller bajo
     * `/tenant/chat` no lo estaría.
     */
    const rutas: Array<[metodo: 'get' | 'post' | 'delete', ruta: string]> = [
      ['get', `/tenant/chat/contacts/${UUID}/context`],
      ['post', `/tenant/chat/conversations/${UUID}/status`],
      ['post', `/tenant/chat/contacts/${UUID}/notify-operator`],
      ['post', `/tenant/chat/contacts/${UUID}/create-player`],
      ['get', `/tenant/chat/contacts/${UUID}/notes`],
      ['post', `/tenant/chat/contacts/${UUID}/notes`],
      ['get', '/tenant/chat/tags'],
      ['post', '/tenant/chat/tags'],
      ['get', `/tenant/chat/contacts/${UUID}/tags`],
      ['post', `/tenant/chat/contacts/${UUID}/tags`],
      ['delete', `/tenant/chat/contacts/${UUID}/tags/${UUID}`],
      ['get', '/tenant/chat/templates'],
      ['post', '/tenant/chat/templates'],
      ['delete', `/tenant/chat/templates/${UUID}`],
    ];

    it.each(rutas)('%s %s → 403', async (metodo, ruta) => {
      const res = await ctx.request[metodo](ruta)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken)
        .send({});

      // 403 y no 404: el guard corta ANTES de mirar si el recurso existe. Si
      // alguna diera 404, querría decir que el handler llegó a ejecutarse.
      expect(res.status).toBe(403);
    });

    /**
     * ⚠️ El token de WebSocket **no** pasa por el guard del CRM
     * (`ChatController` sólo tiene `TenantJwtGuard`), así que un cajero
     * dependiente SÍ puede pedirlo. No es un agujero: el gateway resuelve la
     * bandeja al conectarse y, sin bandeja, rechaza cada acción.
     *
     * Este test deja escrito ese reparto de responsabilidades, para que nadie
     * lo "arregle" asumiendo que el token ya autoriza algo.
     */
    it('puede pedir un token de WS, pero ese token no le da bandeja', async () => {
      const res = await ctx.request
        .post('/tenant/chat/ws-token')
        .set('Host', TEST_TENANT.host)
        .set('Authorization', cajeroToken)
        .send({});
      expect(res.status).toBe(200);
      expect(typeof res.body.token).toBe('string');

      // Lo que el gateway consulta en cada acción. `null` = sin bandeja.
      const net = ctx.app.get(CrmNetworkService);
      const cajeroId = (
        await una<{ id: string }>(
          await ctx.tenantDb.execute(
            sql`SELECT id FROM users WHERE username = ${TEST_TENANT.cajero1.username}`,
          ),
        )
      ).id;
      expect(await net.resolveInboxOwner(ctx.tenantDb, cajeroId)).toBeNull();
    });
  });

  // ── La función de la que dependen las dos reglas ──────────────────────────

  describe('resolveInboxOwner — el chokepoint', () => {
    it('staff central → la bandeja central', async () => {
      const net = ctx.app.get(CrmNetworkService);
      expect(await net.resolveInboxOwner(ctx.tenantDb, adminId)).toBe(adminId);
    });

    it('red independiente → SÓLO la suya', async () => {
      const net = ctx.app.get(CrmNetworkService);
      expect(await net.resolveInboxOwner(ctx.tenantDb, litoral.id)).toBe(
        litoral.id,
      );
      expect(
        await net.resolveInboxOwner(ctx.tenantDb, cajeroDeLitoral.id),
      ).toBe(cajeroDeLitoral.id);
    });
  });

  // ── 5 · Un socio no ve las bandejas de sus cajeros ────────────────────────

  describe('un socio independiente no ve las conversaciones de su cajero', () => {
    let contactId = '';

    beforeAll(async () => {
      // El jugador del cajero escribe: su conversación queda asignada al
      // cajero, que es su operador directo.
      const c = await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`INSERT INTO crm_contacts (user_id, owner_user_id, display_name, is_lead)
              VALUES (${jugadorDelCajero.id}, ${cajeroDeLitoral.id}, 'Jugador', false)
              RETURNING id`,
        ),
      );
      contactId = c.id;
      await ctx.tenantDb.execute(
        sql`INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id)
            VALUES (${contactId}, ${canalId}, ${cajeroDeLitoral.id})`,
      );
    });

    it('la bandeja del socio no la trae', async () => {
      const chat = ctx.app.get(ChatService);
      const bandeja = await chat.listOperatorInbox(ctx.tenantDb, litoral.id);

      expect(
        bandeja.some((i) => i.contact.id === contactId),
      ).toBe(false);
    });

    it('pero la del cajero sí: es suya', async () => {
      const chat = ctx.app.get(ChatService);
      const bandeja = await chat.listOperatorInbox(
        ctx.tenantDb,
        cajeroDeLitoral.id,
      );

      expect(bandeja.some((i) => i.contact.id === contactId)).toBe(true);
    });

    it('y el socio tampoco puede abrir ese contacto por HTTP', async () => {
      const litoralToken = await loginAs(
        ctx.request,
        litoral.username,
        litoral.password,
      );
      const res = await ctx.request
        .get(`/tenant/chat/contacts/${contactId}/context`)
        .set('Host', TEST_TENANT.host)
        .set('Authorization', litoralToken);

      // El socio NO es el operador directo del jugador (lo es su cajero) y no
      // tiene ninguna conversación asignada con él.
      expect(res.status).toBe(403);
    });
  });

  // ── El freno del alta: homonimos por telefono ────────────────────────────
  //
  // `users.phone` NO es unico, asi que dar de alta desde el chat a alguien
  // que ya tiene cuenta crea una SEGUNDA cuenta con el saldo partido — y las
  // cuentas no se fusionan. El servidor avisa antes de dejar crear.
  //
  // Pero esa busqueda es, literalmente, "deci quien tiene este telefono": sin
  // acotarla seria la forma mas facil de averiguar quien juega en la red de
  // otro socio. Por eso vale la misma regla que `getContext` (R6).
  describe('homonimos: avisa del duplicado sin filtrar entre redes', () => {
    const TEL = '1155667788';

    beforeAll(async () => {
      // El jugador del cajero de Litoral (red independiente) y el admin
      // (central) comparten telefono. Son dos redes distintas a proposito.
      await ctx.tenantDb.execute(
        sql`UPDATE users SET phone = ${TEL} WHERE id = ${jugadorDelCajero.id}`,
      );
    });

    it('sin telefono no busca nada', async () => {
      const crm = ctx.app.get(ChatCrmService);
      const r = await crm.jugadoresConEseTelefono(ctx.tenantDb, {
        telefono: null,
        solicitanteId: adminId,
      });
      expect(r).toEqual([]);
    });

    it('el cajero SI ve al jugador de su propia red', async () => {
      const crm = ctx.app.get(ChatCrmService);
      const r = await crm.jugadoresConEseTelefono(ctx.tenantDb, {
        telefono: TEL,
        solicitanteId: cajeroDeLitoral.id,
      });
      expect(r.map((j) => j.id)).toContain(jugadorDelCajero.id);
    });

    /**
     * ⚠️ El test que justifica el filtro.
     *
     * El staff central pregunta por un telefono que resulta ser de un jugador
     * de una red independiente. Si apareciera, la pantalla de alta seria un
     * buscador de padron ajeno.
     */
    it('el staff central NO ve al jugador de una red independiente', async () => {
      const crm = ctx.app.get(ChatCrmService);
      const r = await crm.jugadoresConEseTelefono(ctx.tenantDb, {
        telefono: TEL,
        solicitanteId: adminId,
      });
      expect(r.map((j) => j.id)).not.toContain(jugadorDelCajero.id);
    });
  });
});
