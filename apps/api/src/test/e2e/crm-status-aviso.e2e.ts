/**
 * E2E: estados de la conversación (1.4) y el aviso de derivación (1.5).
 *
 * ## Lo que se fija acá
 *
 * **D11 — un hilo, para siempre.** Resolver y que la persona vuelva a escribir
 * tiene que **reabrir el mismo hilo**, no abrir otro. Esto tiene una historia:
 * `getOrCreateOpenConversation` buscaba conversaciones `<> 'resolved'`, así que
 * una resuelta no se encontraba y caía al `INSERT`. **No se notaba porque nada
 * marcaba una conversación como resuelta** — la columna existía y ningún código
 * la escribía. Al agregar esa acción, el bug habría aparecido solo.
 *
 * **D8 — derivar es avisar.** A la otra bandeja llega quién escribió y cuándo,
 * **sin una palabra del contenido**. Y por **D6** el aviso cae en la ficha de
 * ESA bandeja, que es distinta de la de acá.
 *
 * **Que no se pueda tocar la conversación de otra bandeja** sabiendo su id.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { ChatService } from '../../chat/chat.service';

const SUITE = `crm-est-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken: string;
let adminId = '';
let canalId = '';

let litoral: TestUser;
let jugador: TestUser;
let litoralToken = '';

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

async function colgarDe(hijo: string, padre: string): Promise<void> {
  await ctx.tenantDb.execute(
    sql`UPDATE user_hierarchy SET until = now()
         WHERE user_id = ${hijo} AND until IS NULL`,
  );
  await ctx.tenantDb.execute(
    sql`INSERT INTO user_hierarchy (id, user_id, parent_user_id, relation_type)
        VALUES (gen_random_uuid(), ${hijo}, ${padre}, 'jugador_de_socio')`,
  );
}

/** Contacto + conversación en la bandeja de `atiende`, con un mensaje entrante. */
async function conversacionEnBandeja(
  jugadorId: string,
  atiende: string,
  owner: string | null,
  cuerpo = 'hola, necesito ayuda',
): Promise<{ contactId: string; conversationId: string }> {
  const c = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_contacts (user_id, owner_user_id, display_name, is_lead)
          VALUES (${jugadorId}, ${owner}, 'Juan Pérez', false) RETURNING id`,
    ),
  );
  const conv = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id)
          VALUES (${c.id}, ${canalId}, ${atiende}) RETURNING id`,
    ),
  );
  await ctx.tenantDb.execute(
    sql`INSERT INTO crm_messages (conversation_id, direction, body)
        VALUES (${conv.id}, 'inbound', ${cuerpo})`,
  );
  return { contactId: c.id, conversationId: conv.id };
}

function pedir(ruta: string, bearer: string) {
  return ctx.request
    .post(ruta)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer);
}

describe('CRM · estados y aviso de derivación', () => {
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
    jugador = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'jugador', role: 'usuario_final',
    });
    await colgarDe(jugador.id, litoral.id);
    litoralToken = await loginAs(ctx.request, litoral.username, litoral.password);
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  // ── 1.4 · Estados ─────────────────────────────────────────────────────────

  describe('estados de la conversación', () => {
    it('resolver, marcar pendiente y reabrir', async () => {
      const { conversationId } = await conversacionEnBandeja(
        jugador.id, litoral.id, litoral.id,
      );

      for (const estado of ['resolved', 'pending', 'open'] as const) {
        const res = await pedir(
          `/tenant/chat/conversations/${conversationId}/status`,
          litoralToken,
        ).send({ status: estado });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(estado);
      }
    });

    it('resolver marca leído: dejar el badge prendido sería mentir', async () => {
      const { conversationId } = await conversacionEnBandeja(
        jugador.id, litoral.id, litoral.id,
      );
      await ctx.tenantDb.execute(
        sql`UPDATE crm_conversations SET unread_for_operator = 3
             WHERE id = ${conversationId}`,
      );

      await pedir(
        `/tenant/chat/conversations/${conversationId}/status`,
        litoralToken,
      ).send({ status: 'resolved' });

      const fila = await una<{ unread_for_operator: number }>(
        await ctx.tenantDb.execute(
          sql`SELECT unread_for_operator FROM crm_conversations
               WHERE id = ${conversationId}`,
        ),
      );
      expect(Number(fila.unread_for_operator)).toBe(0);
    });

    it('un estado inventado se rechaza', async () => {
      const { conversationId } = await conversacionEnBandeja(
        jugador.id, litoral.id, litoral.id,
      );
      const res = await pedir(
        `/tenant/chat/conversations/${conversationId}/status`,
        litoralToken,
      ).send({ status: 'cerrada' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_STATUS');
    });

    /**
     * Con el id de una conversación de OTRA bandeja no se puede hacer nada. Y
     * responde 404, no 403: un 403 confirmaría que esa conversación existe.
     */
    it('no se puede tocar la conversación de otra bandeja', async () => {
      const { conversationId } = await conversacionEnBandeja(
        jugador.id, adminId, null,
      );
      const res = await pedir(
        `/tenant/chat/conversations/${conversationId}/status`,
        litoralToken,
      ).send({ status: 'resolved' });

      expect(res.status).toBe(404);

      const fila = await una<{ status: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT status FROM crm_conversations WHERE id = ${conversationId}`,
        ),
      );
      expect(fila.status).toBe('open');
    });
  });

  // ── D11 · Un hilo, para siempre ───────────────────────────────────────────

  describe('D11 · el hilo se reabre, no se duplica', () => {
    it('una conversación resuelta se reabre en vez de crear otra', async () => {
      const { contactId, conversationId } = await conversacionEnBandeja(
        jugador.id, litoral.id, litoral.id,
      );
      await pedir(
        `/tenant/chat/conversations/${conversationId}/status`,
        litoralToken,
      ).send({ status: 'resolved' });

      // Lo que hace el widget cuando el jugador vuelve a escribir. Se llama al
      // servicio real —no se replica la consulta— para que el test se rompa si
      // alguien vuelve a poner el filtro por `status`.
      const chat = ctx.app.get(ChatService);
      const conv = await chat.getOrCreateOpenConversation(ctx.tenantDb, {
        contactId,
        channelId: canalId,
        operatorId: litoral.id,
      });

      expect(conv.id).toBe(conversationId); // el MISMO hilo
      expect(conv.status).toBe('open');

      const filas = (await ctx.tenantDb.execute(
        sql`SELECT id FROM crm_conversations WHERE contact_id = ${contactId}`,
      )) as unknown as Array<{ id: string }>;
      expect(filas).toHaveLength(1); // y sigue habiendo uno solo
    });
  });

  // ── 1.5 · El aviso (D8) ───────────────────────────────────────────────────

  describe('D8 · derivar es avisar', () => {
    it('el aviso llega a la otra bandeja SIN el contenido', async () => {
      // El staff central atiende a un jugador de Litoral. Lo que le escribió
      // lleva una marca única: si aparece del otro lado, D8 está roto.
      const SECRETO = `SOLO-PARA-EL-CENTRAL-${Date.now()}`;
      const { contactId } = await conversacionEnBandeja(
        jugador.id, adminId, null, SECRETO,
      );

      const res = await pedir(
        `/tenant/chat/contacts/${contactId}/notify-operator`,
        adminToken,
      ).send({});

      expect(res.status).toBe(201);
      expect(res.body.operatorId).toBe(litoral.id);

      const mensajes = (await ctx.tenantDb.execute(
        sql`SELECT direction, body FROM crm_messages
             WHERE conversation_id = ${res.body.conversationId as string}
             ORDER BY created_at`,
      )) as unknown as Array<{ direction: string; body: string }>;

      const aviso = mensajes.find((m) => m.direction === 'system');
      expect(aviso).toBeDefined();
      expect(aviso!.body).toContain('Juan Pérez escribió al casino');
      expect(aviso!.body).toContain('Se le pidió que te contacte');

      // ⚠️ El corazón de D8: NADA de lo que se habló en la bandeja central
      // puede aparecer del otro lado. Se mira la conversación entera, no sólo
      // el aviso: si algún día se copiaran mensajes, esto lo agarra igual.
      for (const m of mensajes) expect(m.body).not.toContain(SECRETO);
    });

    it('el aviso cae en la ficha de la otra bandeja, no en la de acá (D6)', async () => {
      const { contactId } = await conversacionEnBandeja(
        jugador.id, adminId, null,
      );

      const res = await pedir(
        `/tenant/chat/contacts/${contactId}/notify-operator`,
        adminToken,
      ).send({});

      const conv = await una<{ contact_id: string; assigned_operator_id: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT contact_id, assigned_operator_id FROM crm_conversations
               WHERE id = ${res.body.conversationId as string}`,
        ),
      );
      expect(conv.contact_id).not.toBe(contactId); // OTRA ficha
      expect(conv.assigned_operator_id).toBe(litoral.id);

      const ficha = await una<{ owner_user_id: string | null; user_id: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT owner_user_id, user_id FROM crm_contacts
               WHERE id = ${conv.contact_id}`,
        ),
      );
      // Ficha distinta, mismo jugador: es exactamente D6.
      expect(ficha.owner_user_id).toBe(litoral.id);
      expect(ficha.user_id).toBe(jugador.id);
    });

    /**
     * El aviso queda anotado **en la ficha de acá** (roadmap **4.3**).
     *
     * Es la consecuencia incómoda de D6 + D8: el aviso sale para otra bandeja y
     * crea una ficha allá, así que **de este lado no quedaba ningún rastro** de
     * haberlo mandado. Cuando el mismo jugador vuelve a escribir, "¿ya le
     * avisamos al cajero?" no tenía respuesta.
     *
     * ⚠️ Lo que se anota es **que se avisó**, no qué se habló: la línea de
     * tiempo no es una puerta de atrás a D8.
     */
    it('queda anotado en la línea de tiempo de esta bandeja (4.3)', async () => {
      const { contactId } = await conversacionEnBandeja(
        jugador.id, adminId, null,
      );

      await pedir(
        `/tenant/chat/contacts/${contactId}/notify-operator`,
        adminToken,
      ).send({});

      const eventos = (await ctx.tenantDb.execute(
        sql`SELECT type, summary, metadata FROM crm_timeline_events
             WHERE contact_id = ${contactId}`,
      )) as unknown as Array<{
        type: string;
        summary: string;
        metadata: { actorId?: string; operatorId?: string };
      }>;

      const aviso = eventos.find((e) => e.type === 'aviso');
      expect(aviso).toBeDefined();
      expect(aviso!.summary).toBe('Se le avisó a su operador');
      // A quién se le avisó queda en los ids, para poder cruzarlo después.
      expect(aviso!.metadata.operatorId).toBe(litoral.id);
    });

    it('el aviso prende el badge del que lo recibe', async () => {
      const { contactId } = await conversacionEnBandeja(
        jugador.id, adminId, null,
      );
      const res = await pedir(
        `/tenant/chat/contacts/${contactId}/notify-operator`,
        adminToken,
      ).send({});

      const conv = await una<{ unread_for_operator: number }>(
        await ctx.tenantDb.execute(
          sql`SELECT unread_for_operator FROM crm_conversations
               WHERE id = ${res.body.conversationId as string}`,
        ),
      );
      // `postMessage` no toca contadores para los `system`. Sin este bump, el
      // aviso no lo vería nadie — que es justo lo que viene a evitar.
      expect(Number(conv.unread_for_operator)).toBeGreaterThan(0);
    });

    it('avisarle a la bandeja de uno mismo no tiene sentido: 400', async () => {
      const { contactId } = await conversacionEnBandeja(
        jugador.id, litoral.id, litoral.id,
      );
      const res = await pedir(
        `/tenant/chat/contacts/${contactId}/notify-operator`,
        litoralToken,
      ).send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SAME_INBOX');
    });

    it('un lead sin jugador vinculado no tiene a quién avisarle', async () => {
      const c = await una<{ id: string }>(
        await ctx.tenantDb.execute(
          sql`INSERT INTO crm_contacts (display_name, is_lead)
              VALUES ('Desconocido', true) RETURNING id`,
        ),
      );
      await ctx.tenantDb.execute(
        sql`INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id)
            VALUES (${c.id}, ${canalId}, ${adminId})`,
      );

      const res = await pedir(
        `/tenant/chat/contacts/${c.id}/notify-operator`,
        adminToken,
      ).send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('CONTACT_NOT_LINKED');
    });
  });
});
