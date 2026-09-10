/**
 * E2E: el webhook de Telegram (2.2 + 2.3).
 *
 * Es el primer momento en que un mensaje entra al CRM **desde afuera de la
 * plataforma**, así que acá se prueba de verdad la cadena entera: llega un
 * update, se guarda el crudo, se crea el contacto, la conversación y el
 * mensaje, y todo cae en la bandeja que corresponde.
 *
 * ## Lo que se fija
 *
 * - **Autenticidad.** Sin el header correcto no entra nada, y **no se guarda
 *   crudo**: si no, cualquiera que sepa la URL nos llena la tabla.
 * - **Idempotencia.** Un reintento de Telegram —el mismo `update_id`— no puede
 *   crear el mensaje dos veces.
 * - **D2.** El mensaje cae en la bandeja **dueña del canal**.
 * - **D6.** El mismo humano escribiéndole al bot de otro operador es **otro
 *   contacto**.
 * - **Siempre 200.** Un error nuestro le diría a Telegram que reintente, y
 *   reintentar no arregla un payload que no sabemos leer.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';

const SUITE = `tgwh-${Date.now().toString(36)}`;

let ctx: TestApp;
let adminToken = '';
let adminId = '';
let litoral: TestUser;

/** Canal de Litoral y canal central, con sus secretos. */
let canalLitoral = { id: '', secreto: '' };
let canalCentral = { id: '', secreto: '' };

let seq = 0;
const proximoUpdate = () => 100000 + seq++;

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

async function crearCanal(owner: string | null) {
  const secreto = `sec-${Math.random().toString(36).slice(2)}${'0'.repeat(20)}`;
  const fila = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_channels (type, owner_user_id, webhook_secret, is_active, config)
          VALUES ('telegram', ${owner}, ${secreto}, true, '{"botId":"1","username":"b"}'::jsonb)
          RETURNING id`,
    ),
  );
  return { id: fila.id, secreto };
}

/** Un update de Telegram como el que manda de verdad. */
function update(opts: {
  updateId?: number;
  chatId: number;
  texto?: string;
  messageId?: number;
  nombre?: string;
}) {
  return {
    update_id: opts.updateId ?? proximoUpdate(),
    message: {
      message_id: opts.messageId ?? Math.floor(Math.random() * 1e6),
      date: Math.floor(Date.now() / 1000),
      text: opts.texto ?? 'hola, necesito ayuda',
      chat: { id: opts.chatId, type: 'private' },
      from: {
        id: opts.chatId,
        first_name: opts.nombre ?? 'Juan',
        last_name: 'Pérez',
        username: 'juanp',
      },
    },
  };
}

function postWebhook(
  canal: { id: string; secreto: string },
  body: unknown,
  opts: { secreto?: string; slug?: string } = {},
) {
  const req = ctx.request
    .post(
      `/api/v1/crm/telegram/webhook/${opts.slug ?? TEST_TENANT.slug}/${canal.id}`,
    )
    // Telegram no manda Host del tenant: por eso el slug va en la URL.
    .set('Host', TEST_TENANT.host);
  const secreto = opts.secreto ?? canal.secreto;
  if (secreto) req.set('X-Telegram-Bot-Api-Secret-Token', secreto);
  return req.send(body as object);
}

async function mensajesDe(chatId: number, owner: string | null) {
  return (await ctx.tenantDb.execute(
    sql`SELECT m.body, m.direction, m.channel_message_id, c.owner_user_id
          FROM crm_messages m
          JOIN crm_conversations conv ON conv.id = m.conversation_id
          JOIN crm_contacts c ON c.id = conv.contact_id
         WHERE c.attributes -> 'telegram' ->> 'chatId' = ${String(chatId)}
           AND (${owner}::uuid IS NULL AND c.owner_user_id IS NULL
                OR c.owner_user_id = ${owner}::uuid)
         ORDER BY m.created_at`,
  )) as unknown as Array<{
    body: string;
    direction: string;
    channel_message_id: string | null;
    owner_user_id: string | null;
  }>;
}

describe('CRM · webhook de Telegram', () => {
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

    litoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'litoral', role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${litoral.id}`,
    );

    canalLitoral = await crearCanal(litoral.id);
    canalCentral = await crearCanal(null);
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  // ── Autenticidad ──────────────────────────────────────────────────────────

  describe('sólo entra lo que viene de Telegram', () => {
    it('sin el header no pasa nada, y NO se guarda crudo', async () => {
      const antes = await una<{ n: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT count(*)::text AS n FROM crm_raw_events`,
        ),
      );

      const res = await postWebhook(canalLitoral, update({ chatId: 555001 }), {
        secreto: '',
      });

      // 200 igual: un error le confirmaría a quien probó que la URL existe.
      expect(res.status).toBe(200);

      const despues = await una<{ n: string }>(
        await ctx.tenantDb.execute(
          sql`SELECT count(*)::text AS n FROM crm_raw_events`,
        ),
      );
      // Guardar el crudo acá dejaría que cualquiera nos llene la tabla.
      expect(despues.n).toBe(antes.n);
    });

    it('con un secreto que no matchea, tampoco', async () => {
      const res = await postWebhook(canalLitoral, update({ chatId: 555002 }), {
        secreto: 'a'.repeat(64),
      });

      expect(res.status).toBe(200);
      expect(await mensajesDe(555002, litoral.id)).toHaveLength(0);
    });

    it('un slug de otro casino no resuelve nada', async () => {
      const res = await postWebhook(canalLitoral, update({ chatId: 555003 }), {
        slug: 'casino-que-no-existe',
      });

      expect(res.status).toBe(200);
      expect(await mensajesDe(555003, litoral.id)).toHaveLength(0);
    });
  });

  // ── El camino feliz ───────────────────────────────────────────────────────

  it('un mensaje entra y queda en la bandeja del dueño del canal (D2)', async () => {
    const chatId = 556001;
    const res = await postWebhook(
      canalLitoral,
      update({ chatId, texto: 'che, me cargás?' }),
    );

    expect(res.status).toBe(200);

    const msgs = await mensajesDe(chatId, litoral.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toBe('che, me cargás?');
    expect(msgs[0]!.direction).toBe('inbound');
    expect(msgs[0]!.owner_user_id).toBe(litoral.id);
  });

  it('la conversación queda asignada a la bandeja que la atiende', async () => {
    const chatId = 556002;
    await postWebhook(canalLitoral, update({ chatId }));

    const conv = await una<{ assigned_operator_id: string }>(
      await ctx.tenantDb.execute(
        sql`SELECT conv.assigned_operator_id
              FROM crm_conversations conv
              JOIN crm_contacts c ON c.id = conv.contact_id
             WHERE c.attributes -> 'telegram' ->> 'chatId' = ${String(chatId)}`,
      ),
    );
    expect(conv.assigned_operator_id).toBe(litoral.id);
  });

  /**
   * Para un canal central, `owner_user_id` es NULL pero la conversación se
   * asigna al **admin principal** — que es lo que `resolveInboxOwner` le
   * devuelve al staff. Si no coincidieran, la conversación no le aparecería a
   * nadie.
   */
  it('en el canal central la conversación va al admin principal', async () => {
    const chatId = 556003;
    await postWebhook(canalCentral, update({ chatId }));

    const conv = await una<{ assigned_operator_id: string; owner: string | null }>(
      await ctx.tenantDb.execute(
        sql`SELECT conv.assigned_operator_id, c.owner_user_id AS owner
              FROM crm_conversations conv
              JOIN crm_contacts c ON c.id = conv.contact_id
             WHERE c.attributes -> 'telegram' ->> 'chatId' = ${String(chatId)}`,
      ),
    );
    expect(conv.owner).toBeNull();
    expect(conv.assigned_operator_id).toBe(adminId);
  });

  it('nace como LEAD: Telegram no da el teléfono, así que D4 no aplica', async () => {
    const chatId = 556004;
    await postWebhook(canalLitoral, update({ chatId, nombre: 'Ana' }));

    const c = await una<{ is_lead: boolean; user_id: string | null; display_name: string }>(
      await ctx.tenantDb.execute(
        sql`SELECT is_lead, user_id, display_name FROM crm_contacts
             WHERE attributes -> 'telegram' ->> 'chatId' = ${String(chatId)}`,
      ),
    );
    expect(c.is_lead).toBe(true);
    expect(c.user_id).toBeNull();
    expect(c.display_name).toBe('Ana Pérez');
  });

  it('dos mensajes de la misma persona van al MISMO hilo', async () => {
    const chatId = 556005;
    await postWebhook(canalLitoral, update({ chatId, texto: 'uno' }));
    await postWebhook(canalLitoral, update({ chatId, texto: 'dos' }));

    const msgs = await mensajesDe(chatId, litoral.id);
    expect(msgs.map((m) => m.body)).toEqual(['uno', 'dos']);

    const convs = (await ctx.tenantDb.execute(
      sql`SELECT conv.id FROM crm_conversations conv
            JOIN crm_contacts c ON c.id = conv.contact_id
           WHERE c.attributes -> 'telegram' ->> 'chatId' = ${String(chatId)}`,
    )) as unknown as unknown[];
    expect(convs).toHaveLength(1);
  });

  // ── Idempotencia ──────────────────────────────────────────────────────────

  /**
   * ⚠️ **El test que justifica el índice único de la migración 0113.**
   *
   * Telegram reintenta si tardamos en responder. Sin unicidad, el operador ve
   * al jugador escribiendo duplicado.
   */
  it('un reintento con el mismo update_id no duplica el mensaje', async () => {
    const chatId = 557001;
    const updateId = proximoUpdate();
    const cuerpo = update({ chatId, updateId, texto: 'una sola vez' });

    await postWebhook(canalLitoral, cuerpo);
    const segunda = await postWebhook(canalLitoral, cuerpo);

    expect(segunda.status).toBe(200);
    const msgs = await mensajesDe(chatId, litoral.id);
    expect(msgs).toHaveLength(1);
  });

  /**
   * El `message_id` de Telegram es un contador **por chat**, no por bot: el
   * primer mensaje de cada persona nueva es `1`. Si la clave de idempotencia no
   * incluye el chat, la segunda persona choca contra el índice único de la
   * migración `0113` y **su mensaje se descarta en silencio** — el fallo de
   * procesamiento no se propaga a propósito, así que ni siquiera hay error.
   *
   * ⚠️ Los `messageId` van fijos y **tienen que ser iguales**. El helper
   * `update()` usa uno al azar cuando no se lo pasan, y con ids al azar no hay
   * colisión: por eso esto no se veía en la suite.
   */
  it('dos personas con el mismo message_id entran las dos', async () => {
    const unaPersona = 557101;
    const otraPersona = 557102;

    await postWebhook(
      canalLitoral,
      update({ chatId: unaPersona, messageId: 1, texto: 'soy la primera' }),
    );
    const segunda = await postWebhook(
      canalLitoral,
      update({ chatId: otraPersona, messageId: 1, texto: 'soy la segunda' }),
    );

    expect(segunda.status).toBe(200);

    const deUna = await mensajesDe(unaPersona, litoral.id);
    const deOtra = await mensajesDe(otraPersona, litoral.id);
    expect(deUna.map((m) => m.body)).toEqual(['soy la primera']);
    expect(deOtra.map((m) => m.body)).toEqual(['soy la segunda']);
    // Y las claves tienen que ser distintas, que es la causa de fondo.
    expect(deUna[0]!.channel_message_id).not.toBe(deOtra[0]!.channel_message_id);
  });

  it('el crudo también se guarda una sola vez', async () => {
    const chatId = 557002;
    const updateId = proximoUpdate();
    const cuerpo = update({ chatId, updateId });

    await postWebhook(canalLitoral, cuerpo);
    await postWebhook(canalLitoral, cuerpo);

    const n = await una<{ n: string }>(
      await ctx.tenantDb.execute(
        sql`SELECT count(*)::text AS n FROM crm_raw_events
             WHERE external_id = ${String(updateId)}`,
      ),
    );
    expect(Number(n.n)).toBe(1);
  });

  it('el crudo queda marcado como procesado', async () => {
    const chatId = 557003;
    const updateId = proximoUpdate();
    await postWebhook(canalLitoral, update({ chatId, updateId }));

    const raw = await una<{ processed_at: string | null; error: string | null }>(
      await ctx.tenantDb.execute(
        sql`SELECT processed_at, error FROM crm_raw_events
             WHERE external_id = ${String(updateId)}`,
      ),
    );
    expect(raw.processed_at).not.toBeNull();
    expect(raw.error).toBeNull();
  });

  // ── D6 ────────────────────────────────────────────────────────────────────

  /**
   * El mismo humano, escribiéndole al bot de otro operador, es **otro
   * contacto**. Es D6 aplicado a Telegram: sin ficha compartida no hay
   * superficie por la que se filtre nada entre bandejas.
   */
  it('el mismo chat en dos canales son DOS contactos (D6)', async () => {
    const chatId = 558001;
    await postWebhook(canalLitoral, update({ chatId, texto: 'a Litoral' }));
    await postWebhook(canalCentral, update({ chatId, texto: 'al casino' }));

    const contactos = (await ctx.tenantDb.execute(
      sql`SELECT owner_user_id FROM crm_contacts
           WHERE attributes -> 'telegram' ->> 'chatId' = ${String(chatId)}`,
    )) as unknown as Array<{ owner_user_id: string | null }>;

    expect(contactos).toHaveLength(2);
    expect(contactos.map((c) => c.owner_user_id).sort()).toEqual(
      [litoral.id, null].sort(),
    );

    // Y cada bandeja ve sólo lo suyo.
    expect((await mensajesDe(chatId, litoral.id)).map((m) => m.body)).toEqual([
      'a Litoral',
    ]);
    expect((await mensajesDe(chatId, null)).map((m) => m.body)).toEqual([
      'al casino',
    ]);
  });

  // ── Lo que no sabemos leer ────────────────────────────────────────────────

  it('un update sin mensaje se guarda pero no crea nada', async () => {
    const updateId = proximoUpdate();
    const res = await postWebhook(canalLitoral, {
      update_id: updateId,
      // Telegram manda de todo: encuestas, reacciones, miembros de un grupo.
      poll: { id: '1', question: '¿?' },
    });

    expect(res.status).toBe(200);
    const raw = await una<{ processed_at: string | null }>(
      await ctx.tenantDb.execute(
        sql`SELECT processed_at FROM crm_raw_events WHERE external_id = ${String(updateId)}`,
      ),
    );
    // Procesado, no fallado: no había nada que hacer con él.
    expect(raw.processed_at).not.toBeNull();
  });

  it('un cuerpo vacío no rompe: siempre 200', async () => {
    const res = await postWebhook(canalLitoral, {});
    expect(res.status).toBe(200);
  });

  // ── Adjuntos (2.4) ────────────────────────────────────────────────────────

  describe('adjuntos', () => {
    /**
     * El canal de esta suite no tiene token guardado, así que la descarga ni se
     * intenta. Lo que importa es que **el mensaje llegue igual y diga qué
     * pasó**: un mensaje vacío haría pensar al operador que se rompió algo.
     */
    it('si el archivo no se pudo traer, el mensaje lo dice', async () => {
      const chatId = 559001;
      await postWebhook(canalLitoral, {
        update_id: proximoUpdate(),
        message: {
          message_id: 1,
          chat: { id: chatId },
          from: { id: chatId, first_name: 'Foto' },
          photo: [{ file_id: 'abc', file_size: 1000 }],
        },
      });

      const msgs = await mensajesDe(chatId, litoral.id);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.body).toContain('no se pudo traer');
    });

    /**
     * Una nota de voz **se intenta bajar** desde el **3.5** (audio sí, video
     * no). Antes se nombraba sin intentarlo, que era el rodeo correcto mientras
     * no se pudieran guardar.
     *
     * Acá el canal no tiene token, así que la descarga falla y el mensaje dice
     * *"no se pudo traer"* — igual que la foto de arriba. Eso es justamente lo
     * que fija el test: la nota de voz dejó de tomar el camino del rechazo y
     * toma el de los adjuntos. Si volviera al rechazo, el texto diría *"mandó
     * una nota de voz"* y esto fallaría.
     */
    it('una nota de voz se intenta bajar y conserva lo que la persona escribió', async () => {
      const chatId = 559002;
      await postWebhook(canalLitoral, {
        update_id: proximoUpdate(),
        message: {
          message_id: 2,
          chat: { id: chatId },
          from: { id: chatId, first_name: 'Audio' },
          caption: 'escuchá esto',
          voice: { file_id: 'v1', file_size: 5000 },
        },
      });

      const msgs = await mensajesDe(chatId, litoral.id);
      expect(msgs[0]!.body).toContain('escuchá esto');
      expect(msgs[0]!.body).toContain('no se pudo traer');
      // Y NO el aviso de rechazo, que es lo que decía antes del 3.5.
      expect(msgs[0]!.body).not.toContain('mandó una nota de voz');
    });

    it('un video también, sin intentar bajarlo', async () => {
      const chatId = 559003;
      await postWebhook(canalLitoral, {
        update_id: proximoUpdate(),
        message: {
          message_id: 3,
          chat: { id: chatId },
          from: { id: chatId, first_name: 'Video' },
          video: { file_id: 'vid1', file_size: 900_000 },
        },
      });

      expect((await mensajesDe(chatId, litoral.id))[0]!.body).toContain('un video');
    });
  });
});
