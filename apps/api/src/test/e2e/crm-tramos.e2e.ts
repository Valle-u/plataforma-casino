/**
 * E2E: el **tramo** y las métricas de atención.
 *
 * ## Las dos mitades, y por qué se prueban distinto
 *
 * **El motor** (quién abre, quién responde, quién cierra) se prueba por el
 * camino real: `postMessage` y `setConversationStatus`, los mismos que corren
 * cuando entra un mensaje de verdad. Ahí lo que importa es que los tramos se
 * anoten cuando tienen que anotarse — y sobre todo, **que no se anoten cuando
 * no**.
 *
 * **Las métricas** se prueban con tramos escritos a mano. No es una comodidad:
 * para verificar que la mediana es la mediana hace falta poder decir "éste
 * tardó un minuto y éste una hora", y por el camino real cada tramo empieza y
 * termina *ahora*. Con datos fabricados se puede afirmar el número exacto.
 *
 * ## Lo que más importa que esté bien
 *
 * Que un tramo **sin responder no entre en la mediana**. Si entrara como cero,
 * la mediana bajaría justo cuando la atención está peor, y el número quedaría
 * más lindo cuanto más gente se ignora.
 *
 * Y que **mediana no sea promedio**: hay un caso construido para que las dos
 * den distinto (1 min, 2 min y 60 min → mediana 2 min, promedio 21).
 */

import { sql, type SQL } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { ChatService } from '../../chat/chat.service';

const SUITE = `crm-tramos-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken: string;
let chat: ChatService;

let bandeja: TestUser;
let otraBandeja: TestUser;
let tokenBandeja = '';
let canalId = '';
let canalTelegramId = '';

async function fila<T>(consulta: SQL): Promise<T | undefined> {
  const r = await ctx.tenantDb.execute(consulta);
  return (r as unknown as T[])[0];
}

async function todas<T>(consulta: SQL): Promise<T[]> {
  return (await ctx.tenantDb.execute(consulta)) as unknown as T[];
}

/** Una conversación nueva colgada de una bandeja, con su contacto. */
async function conversacion(
  atiende: string,
  canal = canalId,
): Promise<string> {
  const c = await fila<{ id: string }>(
    sql`INSERT INTO crm_contacts (user_id, display_name, is_lead)
        VALUES (NULL, 'Tramos', true) RETURNING id`,
  );
  const conv = await fila<{ id: string }>(
    sql`INSERT INTO crm_conversations (contact_id, channel_id, assigned_operator_id)
        VALUES (${c!.id}, ${canal}, ${atiende}) RETURNING id`,
  );
  return conv!.id;
}

interface Tramo {
  id: string;
  started_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
}

async function tramosDe(conversationId: string): Promise<Tramo[]> {
  return todas<Tramo>(
    sql`SELECT id, started_at, first_response_at, resolved_at
          FROM crm_conversation_segments
         WHERE conversation_id = ${conversationId}
         ORDER BY started_at`,
  );
}

/**
 * Un tramo escrito directo, con las duraciones que el test necesita. `respuesta`
 * y `resolucion` son minutos desde que empezó; `null` es "todavía no pasó".
 */
async function tramoFabricado(
  conversationId: string,
  opciones: {
    haceHoras: number;
    respuestaEnMin?: number | null;
    resolucionEnMin?: number | null;
  },
): Promise<void> {
  const { haceHoras, respuestaEnMin = null, resolucionEnMin = null } = opciones;
  await ctx.tenantDb.execute(sql`
    INSERT INTO crm_conversation_segments
      (conversation_id, started_at, first_response_at, resolved_at)
    VALUES (
      ${conversationId},
      now() - make_interval(hours => ${haceHoras}),
      ${respuestaEnMin === null
        ? sql`NULL`
        : sql`now() - make_interval(hours => ${haceHoras}) + make_interval(mins => ${respuestaEnMin})`},
      ${resolucionEnMin === null
        ? sql`NULL`
        : sql`now() - make_interval(hours => ${haceHoras}) + make_interval(mins => ${resolucionEnMin})`}
    )
  `);
}

/**
 * Deja la bandeja sin tramos.
 *
 * Los tests del motor dejan los suyos, así que sin esto los de lectura contarían
 * lo que fabricó el test más lo que quedó de antes — y las afirmaciones exactas
 * ("la mediana es 120 segundos") no se podrían escribir.
 */
async function bandejaLimpia(): Promise<void> {
  await ctx.tenantDb.execute(sql`
    DELETE FROM crm_conversation_segments s
     USING crm_conversations c
     WHERE c.id = s.conversation_id
       AND c.assigned_operator_id = ${bandeja.id}
  `);
}

interface Metricas {
  sinResponder: { total: number; viejos: number; masViejo: string | null };
  ventana: number;
  tramos: number;
  respondidos: number;
  resueltos: number;
  medianaRespuesta: number | null;
  medianaResolucion: number | null;
  porCanal: Array<{ canal: string; total: number }>;
  midiendoDesde: string | null;
}

async function metricas(dias?: number): Promise<Metricas> {
  const res = await ctx.request
    .get(`/tenant/chat/metricas${dias ? `?dias=${dias}` : ''}`)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', tokenBandeja);
  if (res.status !== 200) {
    throw new Error(`metricas devolvió ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body as Metricas;
}

describe('CRM · el tramo y las métricas de atención', () => {
  beforeAll(async () => {
    ctx = await bootstrapTestApp();
    adminToken = await loginAsAdmin(ctx.request);
    chat = ctx.app.get(ChatService);

    bandeja = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'bandeja',
      role: 'socio',
    });
    otraBandeja = await createTestUser(ctx.request, adminToken, {
      suite: SUITE,
      label: 'otra',
      role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true
           WHERE id IN (${bandeja.id}, ${otraBandeja.id})`,
    );
    tokenBandeja = await loginAs(ctx.request, bandeja.username, bandeja.password);

    const web = await fila<{ id: string }>(
      sql`INSERT INTO crm_channels (type) VALUES ('web-livechat') RETURNING id`,
    );
    canalId = web!.id;
    const tg = await fila<{ id: string }>(
      sql`INSERT INTO crm_channels (type) VALUES ('telegram') RETURNING id`,
    );
    canalTelegramId = tg!.id;
  }, 60_000);

  afterAll(async () => {
    // Los canales tienen `RESTRICT`: sin limpiar las conversaciones, la suite
    // que borra canales en su `beforeEach` falla por culpa de ésta.
    await ctx.tenantDb.execute(
      sql`DELETE FROM crm_conversations
           WHERE channel_id IN (${canalId}, ${canalTelegramId})`,
    );
    await ctx.tenantDb.execute(
      sql`DELETE FROM crm_channels WHERE id IN (${canalId}, ${canalTelegramId})`,
    );
    await ctx.close();
  });

  // ── El motor: quién abre, quién responde, quién cierra ───────────────────

  describe('qué abre un tramo', () => {
    it('un mensaje del jugador lo abre', async () => {
      const conv = await conversacion(bandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'inbound',
        senderUserId: null,
        body: 'hola',
      });

      const tramos = await tramosDe(conv);
      expect(tramos).toHaveLength(1);
      expect(tramos[0]!.first_response_at).toBeNull();
      expect(tramos[0]!.resolved_at).toBeNull();
    });

    it('un segundo mensaje NO abre otro: hay un solo tramo abierto', async () => {
      const conv = await conversacion(bandeja.id);
      for (const body of ['hola', 'estás?', 'holaaa']) {
        await chat.postMessage(ctx.tenantDb, {
          conversationId: conv,
          direction: 'inbound',
          senderUserId: null,
          body,
        });
      }

      expect(await tramosDe(conv)).toHaveLength(1);
    });

    it('un aviso del sistema (D8) también lo abre', async () => {
      // Cuentan a propósito: un aviso ignorado es el agujero que dejan D8 y
      // D10 juntos, y es lo único que lo muestra.
      const conv = await conversacion(bandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'system',
        senderUserId: null,
        body: 'te escribió un jugador tuyo',
      });

      expect(await tramosDe(conv)).toHaveLength(1);
    });

    it('un mensaje del operador NO abre tramo', async () => {
      // Si escribe primero, no hay ninguna espera que medir. Un tramo así
      // entraría con primera respuesta instantánea y bajaría la mediana de
      // todos los demás sin que nadie haya atendido mejor.
      const conv = await conversacion(bandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'outbound',
        senderUserId: bandeja.id,
        body: 'hola, todo bien?',
      });

      expect(await tramosDe(conv)).toHaveLength(0);
    });
  });

  describe('qué cuenta como primera respuesta', () => {
    it('el primer mensaje del operador la marca', async () => {
      const conv = await conversacion(bandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'inbound',
        senderUserId: null,
        body: 'hola',
      });
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'outbound',
        senderUserId: bandeja.id,
        body: 'decime',
      });

      const tramos = await tramosDe(conv);
      expect(tramos[0]!.first_response_at).not.toBeNull();
    });

    it('el segundo mensaje del operador no la pisa', async () => {
      const conv = await conversacion(bandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'inbound',
        senderUserId: null,
        body: 'hola',
      });
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'outbound',
        senderUserId: bandeja.id,
        body: 'decime',
      });
      const primera = (await tramosDe(conv))[0]!.first_response_at;

      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'outbound',
        senderUserId: bandeja.id,
        body: 'ahí va',
      });

      expect((await tramosDe(conv))[0]!.first_response_at).toEqual(primera);
    });

    it('un aviso del sistema NO cuenta como respuesta al jugador', async () => {
      const conv = await conversacion(bandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'inbound',
        senderUserId: null,
        body: 'hola',
      });
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'system',
        senderUserId: null,
        body: 'derivado',
      });

      expect((await tramosDe(conv))[0]!.first_response_at).toBeNull();
    });
  });

  describe('cerrar y volver a empezar', () => {
    it('resolver cierra el tramo', async () => {
      const conv = await conversacion(bandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'inbound',
        senderUserId: null,
        body: 'hola',
      });
      await chat.setConversationStatus(ctx.tenantDb, {
        conversationId: conv,
        inboxOwnerId: bandeja.id,
        status: 'resolved',
      });

      expect((await tramosDe(conv))[0]!.resolved_at).not.toBeNull();
    });

    it('volver a escribir después de resuelto abre un tramo NUEVO', async () => {
      // Es la razón de ser de toda la tabla: por D11 el hilo es el mismo para
      // siempre, así que sin tramos esto sería "una conversación de seis
      // meses" en vez de dos atenciones distintas.
      const conv = await conversacion(bandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'inbound',
        senderUserId: null,
        body: 'primera vez',
      });
      await chat.setConversationStatus(ctx.tenantDb, {
        conversationId: conv,
        inboxOwnerId: bandeja.id,
        status: 'resolved',
      });
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'inbound',
        senderUserId: null,
        body: 'volví',
      });

      const tramos = await tramosDe(conv);
      expect(tramos).toHaveLength(2);
      expect(tramos[0]!.resolved_at).not.toBeNull();
      expect(tramos[1]!.resolved_at).toBeNull();
    });

    it('marcar pendiente NO cierra el tramo', async () => {
      // `pending` es "se respondió y se espera algo de afuera": la atención
      // sigue abierta, y contarla como terminada acortaría la medición.
      const conv = await conversacion(bandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'inbound',
        senderUserId: null,
        body: 'hola',
      });
      await chat.setConversationStatus(ctx.tenantDb, {
        conversationId: conv,
        inboxOwnerId: bandeja.id,
        status: 'pending',
      });

      expect((await tramosDe(conv))[0]!.resolved_at).toBeNull();
    });

    it('no se puede cerrar el tramo de otra bandeja', async () => {
      const conv = await conversacion(otraBandeja.id);
      await chat.postMessage(ctx.tenantDb, {
        conversationId: conv,
        direction: 'inbound',
        senderUserId: null,
        body: 'hola',
      });

      const r = await chat.setConversationStatus(ctx.tenantDb, {
        conversationId: conv,
        inboxOwnerId: bandeja.id,
        status: 'resolved',
      });

      expect(r).toBeNull();
      expect((await tramosDe(conv))[0]!.resolved_at).toBeNull();
    });
  });

  // ── Las métricas ────────────────────────────────────────────────────────

  describe('sin responder — la única imprescindible', () => {
    it('cuenta los tramos abiertos que nadie contestó, y los de más de 24 h', async () => {
      await bandejaLimpia();
      const nuevo = await conversacion(bandeja.id);
      const viejo = await conversacion(bandeja.id);
      const atendido = await conversacion(bandeja.id);
      await tramoFabricado(nuevo, { haceHoras: 2 });
      await tramoFabricado(viejo, { haceHoras: 50 });
      await tramoFabricado(atendido, { haceHoras: 30, respuestaEnMin: 5 });

      const m = await metricas();

      expect(m.sinResponder.total).toBe(2);
      expect(m.sinResponder.viejos).toBe(1);
      expect(m.sinResponder.masViejo).not.toBeNull();
    });

    it('un tramo resuelto sin respuesta tampoco aparece: ya no espera nadie', async () => {
      await bandejaLimpia();
      const conv = await conversacion(bandeja.id);
      await tramoFabricado(conv, { haceHoras: 40, resolucionEnMin: 10 });

      const m = await metricas();
      const abiertos = await todas<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM crm_conversation_segments s
          JOIN crm_conversations c ON c.id = s.conversation_id
         WHERE c.assigned_operator_id = ${bandeja.id}
           AND s.resolved_at IS NULL AND s.first_response_at IS NULL
      `);

      expect(m.sinResponder.total).toBe(abiertos[0]!.n);
    });
  });

  describe('la mediana', () => {
    it('es la mediana, no el promedio', async () => {
      await bandejaLimpia();
      // 1, 2 y 60 minutos: mediana 2 min (120 s), promedio 21 min (1260 s).
      for (const min of [1, 2, 60]) {
        const conv = await conversacion(bandeja.id);
        await tramoFabricado(conv, { haceHoras: 3, respuestaEnMin: min });
      }

      const m = await metricas();

      expect(m.medianaRespuesta).toBe(120);
      expect(m.respondidos).toBe(3);
    });

    it('un tramo sin responder NO entra: no es una espera de cero', async () => {
      await bandejaLimpia();
      // Dos respondidos rápido y uno abandonado hace dos días. Si el
      // abandonado entrara como cero, la mediana bajaría justo cuando la
      // atención está peor.
      const a = await conversacion(bandeja.id);
      const b = await conversacion(bandeja.id);
      const abandonado = await conversacion(bandeja.id);
      await tramoFabricado(a, { haceHoras: 3, respuestaEnMin: 10 });
      await tramoFabricado(b, { haceHoras: 3, respuestaEnMin: 20 });
      await tramoFabricado(abandonado, { haceHoras: 48 });

      const m = await metricas();

      expect(m.medianaRespuesta).toBe(900); // 15 min, el punto medio de 10 y 20
      expect(m.tramos).toBe(3);
      expect(m.respondidos).toBe(2);
    });

    it('sin ningún tramo respondido devuelve null, no cero', async () => {
      await bandejaLimpia();
      const conv = await conversacion(bandeja.id);
      await tramoFabricado(conv, { haceHoras: 5 });

      const m = await metricas();

      // Cero se leería como "contestamos al instante", que es lo contrario de
      // lo que pasó.
      expect(m.medianaRespuesta).toBeNull();
      expect(m.medianaResolucion).toBeNull();
    });

    it('la resolución se mide desde que empezó el tramo', async () => {
      await bandejaLimpia();
      const conv = await conversacion(bandeja.id);
      await tramoFabricado(conv, {
        haceHoras: 5,
        respuestaEnMin: 3,
        resolucionEnMin: 45,
      });

      const m = await metricas();

      expect(m.medianaRespuesta).toBe(180);
      expect(m.medianaResolucion).toBe(2700);
      expect(m.resueltos).toBe(1);
    });

    it('la ventana filtra por cuándo EMPEZÓ el tramo', async () => {
      await bandejaLimpia();
      const dentro = await conversacion(bandeja.id);
      const fuera = await conversacion(bandeja.id);
      await tramoFabricado(dentro, { haceHoras: 24 * 3, respuestaEnMin: 5 });
      await tramoFabricado(fuera, { haceHoras: 24 * 20, respuestaEnMin: 90 });

      const semana = await metricas(7);
      const mes = await metricas(30);

      expect(semana.tramos).toBe(1);
      expect(semana.medianaRespuesta).toBe(300);
      expect(mes.tramos).toBe(2);
    });

    it('una ventana inventada cae a 30 días en vez de romper', async () => {
      const m = await metricas(999);
      expect(m.ventana).toBe(30);
    });
  });

  describe('volumen por canal', () => {
    it('cuenta los mensajes que ENTRAN, no los que manda el operador', async () => {
      const web = await conversacion(bandeja.id, canalId);
      const tg = await conversacion(bandeja.id, canalTelegramId);
      const antes = await metricas();
      const previoWeb =
        antes.porCanal.find((c) => c.canal === 'web-livechat')?.total ?? 0;
      const previoTg =
        antes.porCanal.find((c) => c.canal === 'telegram')?.total ?? 0;

      await chat.postMessage(ctx.tenantDb, {
        conversationId: web,
        direction: 'inbound',
        senderUserId: null,
        body: 'por el widget',
      });
      await chat.postMessage(ctx.tenantDb, {
        conversationId: tg,
        direction: 'inbound',
        senderUserId: null,
        body: 'por telegram',
      });
      // Éste no tiene que contar: es del operador.
      await chat.postMessage(ctx.tenantDb, {
        conversationId: tg,
        direction: 'outbound',
        senderUserId: bandeja.id,
        body: 'ya te contesto',
      });

      const m = await metricas();

      expect(m.porCanal.find((c) => c.canal === 'web-livechat')?.total).toBe(
        previoWeb + 1,
      );
      expect(m.porCanal.find((c) => c.canal === 'telegram')?.total).toBe(
        previoTg + 1,
      );
    });
  });

  describe('cada bandeja ve la suya (R6)', () => {
    it('los tramos de otra bandeja no entran en ningún número', async () => {
      const ajena = await conversacion(otraBandeja.id);
      await tramoFabricado(ajena, { haceHoras: 72 });
      await tramoFabricado(await conversacion(otraBandeja.id), {
        haceHoras: 4,
        respuestaEnMin: 300,
      });

      const m = await metricas();
      const propios = await fila<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM crm_conversation_segments s
          JOIN crm_conversations c ON c.id = s.conversation_id
         WHERE c.assigned_operator_id = ${bandeja.id}
           AND s.started_at > now() - interval '30 days'
      `);

      expect(m.tramos).toBe(propios!.n);
    });
  });

  describe('desde cuándo se mide', () => {
    it('informa el tramo más viejo de la bandeja', async () => {
      const conv = await conversacion(bandeja.id);
      await tramoFabricado(conv, { haceHoras: 24 * 90 });

      const m = await metricas();
      const masViejo = await fila<{ d: Date }>(sql`
        SELECT min(s.started_at) AS d FROM crm_conversation_segments s
          JOIN crm_conversations c ON c.id = s.conversation_id
         WHERE c.assigned_operator_id = ${bandeja.id}
      `);

      expect(m.midiendoDesde).not.toBeNull();
      expect(new Date(m.midiendoDesde!).getTime()).toBe(
        new Date(masViejo!.d).getTime(),
      );
    });
  });
});
