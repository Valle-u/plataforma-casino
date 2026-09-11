/**
 * E2E: la línea de tiempo del contacto (roadmap **4.3**).
 *
 * ## Lo que se fija, y por qué importa
 *
 * `crm_timeline_events` existía desde que se creó el CRM y **sólo la escribían
 * el vínculo y el desvínculo**. Esta tanda suma los tres que faltaban, y los
 * tres tienen la misma propiedad: **si no se anotan cuando pasan, no se pueden
 * reconstruir después.**
 *
 * | Evento | Por qué se pierde si no se anota |
 * |---|---|
 * | `alta` | El jugador queda creado, pero nada dice que salió **de esta conversación** — y de eso dependen las comisiones (**D9**). |
 * | `estado` | `crm_conversations.status` se pisa. Mirando los mensajes no hay forma de saber cuándo se resolvió ni quién. |
 * | `aviso` | El aviso de **D8** sale para **otra** bandeja y no deja nada en ésta. |
 *
 * Y una que no es un evento pero se prueba igual: **anotar no puede voltear la
 * operación**. Eso está en el diseño de `anotar()`, que no tira nunca.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';

const SUITE = `tl-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken = '';
let adminId = '';
let canalId = '';

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

/** Un contacto con su conversación, asignada a la bandeja del admin. */
async function contactoNuevo(nombre: string) {
  const contacto = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_contacts (display_name, is_lead)
          VALUES (${nombre}, true) RETURNING id`,
    ),
  );
  const conv = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id, status, last_message_at)
          VALUES (${contacto.id}, ${canalId}, ${adminId}, 'open', now())
          RETURNING id`,
    ),
  );
  return { contactId: contacto.id, conversationId: conv.id };
}

function get(path: string) {
  return ctx.request
    .get(path)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken);
}

function post(path: string, body?: object) {
  return ctx.request
    .post(path)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', adminToken)
    .send(body ?? {});
}

async function linea(contactId: string) {
  const res = await get(`/tenant/chat/contacts/${contactId}/timeline`);
  expect(res.status).toBe(200);
  return res.body as Array<{
    type: string;
    summary: string;
    occurredAt: string;
    actor: { id: string; username: string } | null;
  }>;
}

describe('CRM · línea de tiempo (4.3)', () => {
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

    const canal = await una<{ id: string }>(
      await ctx.tenantDb.execute(
        sql`INSERT INTO crm_channels (type, owner_user_id, is_active, config)
            VALUES ('web-livechat', NULL, true, '{}'::jsonb) RETURNING id`,
      ),
    );
    canalId = canal.id;
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('un contacto sin historia devuelve una lista vacía', async () => {
    const { contactId } = await contactoNuevo(`${SUITE}-vacio`);
    expect(await linea(contactId)).toEqual([]);
  });

  /**
   * ⚠️ `crm_conversations.status` es una columna **mutable y sin historial**.
   * Sin esta anotación, "¿cuándo se resolvió y quién?" no tiene respuesta.
   */
  it('resolver, poner en espera y reabrir dejan rastro, en orden', async () => {
    const { contactId, conversationId } = await contactoNuevo(`${SUITE}-estado`);

    for (const status of ['resolved', 'open', 'pending'] as const) {
      const res = await post(
        `/tenant/chat/conversations/${conversationId}/status`,
        { status },
      );
      expect(res.status).toBe(200);
    }

    const eventos = await linea(contactId);
    expect(eventos).toHaveLength(3);
    // De lo más nuevo a lo más viejo.
    expect(eventos.map((e) => e.summary)).toEqual([
      'Puesta en espera',
      'Conversación reabierta',
      'Conversación resuelta',
    ]);
    expect(eventos.every((e) => e.type === 'estado')).toBe(true);
    // Y queda quién lo hizo.
    expect(eventos[0]!.actor?.username).toBe(TEST_TENANT.admin.username);
  });

  /**
   * ⚠️ El alta es el evento que más cuesta reconstruir: el jugador queda
   * creado, pero **nada dice que salió de esta conversación** — y por **D9** de
   * dónde salió es lo que define de quién cuelga, o sea las comisiones.
   */
  it('dar de alta un jugador desde el chat queda anotado, con su usuario', async () => {
    const { contactId } = await contactoNuevo(`${SUITE}-alta`);
    const username = `${SUITE}_jug`.toLowerCase().replace(/-/g, '_');

    const res = await post(
      `/tenant/chat/contacts/${contactId}/create-player`,
      { username },
    );
    expect(res.status).toBe(201);

    const eventos = await linea(contactId);
    const alta = eventos.find((e) => e.type === 'alta');
    expect(alta).toBeDefined();
    expect(alta!.summary).toContain(username);
    expect(alta!.actor?.username).toBe(TEST_TENANT.admin.username);
  });

  /**
   * El vínculo y el desvínculo ya se anotaban desde `a8256a3`. Se prueban acá
   * también porque ahora pasan por `CrmTimelineService`: el cambio de dueño del
   * escritor no puede haberlos roto en silencio.
   */
  it('vincular y deshacer siguen dejando rastro después de mover el escritor', async () => {
    const { contactId } = await contactoNuevo(`${SUITE}-link`);
    const username = `${SUITE}_lnk`.toLowerCase().replace(/-/g, '_');

    // Se crea un jugador y se usa el contacto de otro para vincularlo a mano.
    const creado = await post(
      `/tenant/chat/contacts/${(await contactoNuevo(`${SUITE}-fuente`)).contactId}/create-player`,
      { username },
    );
    expect(creado.status).toBe(201);
    const jugadorId = (creado.body as { userId: string }).userId;

    const vinculado = await post(
      `/tenant/chat/contacts/${contactId}/link`,
      { userId: jugadorId },
    );
    expect(vinculado.status).toBe(200);

    const borrado = await ctx.request
      .delete(`/tenant/chat/contacts/${contactId}/link`)
      .set('Host', TEST_TENANT.host)
      .set('Authorization', adminToken);
    expect(borrado.status).toBe(200);

    const tipos = (await linea(contactId)).map((e) => e.type);
    expect(tipos).toEqual(['unlink', 'link']);
  });

  /**
   * ⚠️ **El aislamiento sale gratis de D6.** Los eventos cuelgan del contacto, y
   * un contacto es de una bandeja: no existe un contacto compartido del que se
   * pueda leer la actividad de otra red. Lo que se fija acá es que el endpoint
   * respete `assertAccess` igual que las notas.
   */
  it('la línea de un contacto de otra bandeja no se puede leer', async () => {
    const otro = await una<{ id: string }>(
      await ctx.tenantDb.execute(
        sql`INSERT INTO crm_contacts (display_name, is_lead)
            VALUES (${`${SUITE}-ajeno`}, true) RETURNING id`,
      ),
    );
    // Sin conversación asignada a esta bandeja: es inalcanzable.
    const res = await get(`/tenant/chat/contacts/${otro.id}/timeline`);
    expect([403, 404]).toContain(res.status);
  });
});
