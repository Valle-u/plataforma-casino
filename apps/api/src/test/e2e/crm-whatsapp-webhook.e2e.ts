/**
 * E2E: el webhook de WhatsApp (**3.2**).
 *
 * ## Por qué este archivo existe pudiendo probarse casi todo con unit tests
 *
 * Porque hay una cosa que **sólo se puede probar entrando por HTTP**: que la
 * firma se verifique contra los **bytes crudos** y no contra el JSON que Nest
 * parseó y alguien re-serializó. Ese es el error clásico de esta integración, y
 * un unit test del verificador no lo ataja — el verificador está bien; lo que
 * falla es qué se le pasa.
 *
 * Acá los cuerpos se mandan como string y se firman **ese mismo string**, que es
 * exactamente lo que hace Meta.
 *
 * ## Lo que se fija
 *
 * - **Autenticidad.** Sin firma válida no entra nada, y **no se guarda crudo**:
 *   si no, cualquiera que sepa la URL nos llena la tabla. Y se responde 200
 *   igual, porque un error le dice a Meta que reintente.
 * - **P4.** Una entrega con números de dos casinos se parte, y **el payload de
 *   uno no queda guardado en la base del otro**.
 * - **El apretón de manos.** El `GET` devuelve el challenge en texto plano, y
 *   rechaza el token equivocado.
 * - **Siempre 200**, incluso para un número que no vinculó nadie.
 *
 * ## Lo que NO se prueba acá, porque todavía no existe
 *
 * Que el mensaje se convierta en contacto + conversación. El 3.2 es **la
 * puerta**; el procesamiento es la tanda que sigue, igual que en Telegram el
 * webhook (2.2) vino antes que el ruteo (2.3). Los crudos quedan con
 * `processed_at` en NULL, que es el estado que el diseño define para eso.
 */

import { sql } from 'drizzle-orm';
import { whatsappNumbers, tenants, type ControlDb } from '@casino/db';
import { eq } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { CONTROL_DB } from '../../database/database.module';
import { firmarComoMeta } from '../../chat/whatsapp/firma-de-meta';

const APP_SECRET = 'app-secret-de-jest';
const VERIFY_TOKEN = 'verify-token-de-jest';

const SUITE = Date.now().toString(36);
/** El número del casino de test, vinculado en la DB de control. */
const NUM_MIO = `num-mio-${SUITE}`;
/** Un número que existe en Meta pero no lo vinculó nadie acá. */
const NUM_AJENO = `num-ajeno-${SUITE}`;
/** Un número vinculado pero desactivado. */
const NUM_INACTIVO = `num-inactivo-${SUITE}`;

let ctx: TestApp;
let controlDb: ControlDb;
let canalId = '';

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

/** Un `change` como el que manda Meta de verdad. */
function cambio(phoneNumberId: string, wamid: string, texto = 'hola') {
  return {
    value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '5493415551234', phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: 'Juan' }, wa_id: '5493415551234' }],
      messages: [
        {
          from: '5493415551234',
          id: wamid,
          timestamp: '1789300000',
          type: 'text',
          text: { body: texto },
        },
      ],
    },
    field: 'messages',
  };
}

function sobre(entradas: Array<{ waba: string; cambios: unknown[] }>) {
  return {
    object: 'whatsapp_business_account',
    entry: entradas.map((e) => ({ id: e.waba, changes: e.cambios })),
  };
}

/**
 * Manda el webhook firmando **el string exacto** que viaja como cuerpo.
 *
 * Es la parte que importa: `.send(objeto)` dejaría que supertest serialice por
 * su cuenta y la firma se calcularía sobre otros bytes — justo el error que este
 * archivo existe para atajar.
 */
function postWebhook(body: unknown, opts: { firma?: string; secreto?: string } = {}) {
  const crudo = JSON.stringify(body);
  const firma = opts.firma ?? firmarComoMeta(crudo, opts.secreto ?? APP_SECRET);
  const req = ctx.request
    .post('/api/v1/crm/whatsapp/webhook')
    .set('Host', TEST_TENANT.host)
    .set('Content-Type', 'application/json');
  if (firma) req.set('X-Hub-Signature-256', firma);
  return req.send(crudo);
}

async function crudosDe(phoneNumberId: string) {
  return (await ctx.tenantDb.execute(
    sql`SELECT id, external_id, processed_at, payload
          FROM crm_raw_events
         WHERE payload::text LIKE ${'%' + phoneNumberId + '%'}
         ORDER BY received_at`,
  )) as unknown as Array<{
    id: string;
    external_id: string | null;
    processed_at: string | null;
    payload: unknown;
  }>;
}

describe('CRM · webhook de WhatsApp (3.2)', () => {
  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

    ctx = await bootstrapTestApp();
    controlDb = ctx.app.get<ControlDb>(CONTROL_DB);

    const canal = await una<{ id: string }>(
      await ctx.tenantDb.execute(
        sql`INSERT INTO crm_channels (type, owner_user_id, is_active, config)
            VALUES ('whatsapp', NULL, true, '{}'::jsonb)
            RETURNING id`,
      ),
    );
    canalId = canal.id;

    const tenant = (
      await controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.slug, TEST_TENANT.slug))
        .limit(1)
    )[0]!;

    await controlDb.insert(whatsappNumbers).values([
      { phoneNumberId: NUM_MIO, tenantId: tenant.id, channelId: canalId, wabaId: 'waba-mio' },
      {
        phoneNumberId: NUM_INACTIVO,
        tenantId: tenant.id,
        channelId: canalId,
        isActive: false,
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await controlDb
      .delete(whatsappNumbers)
      .where(eq(whatsappNumbers.phoneNumberId, NUM_MIO));
    await controlDb
      .delete(whatsappNumbers)
      .where(eq(whatsappNumbers.phoneNumberId, NUM_INACTIVO));
    await ctx.close();
  });

  // ── El apretón de manos (una sola vez, al configurar la App) ───────────────

  describe('verificación (GET)', () => {
    /**
     * El challenge va **en texto plano y tal cual**. Devolverlo como JSON —o
     * entrecomillado— hace que Meta no acepte la URL, y el error que da no
     * explica por qué.
     */
    it('con el token correcto devuelve el challenge crudo', async () => {
      const res = await ctx.request
        .get('/api/v1/crm/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '1234567890',
        })
        .set('Host', TEST_TENANT.host);

      expect(res.status).toBe(200);
      expect(res.text).toBe('1234567890');
    });

    it('con el token equivocado, 403', async () => {
      const res = await ctx.request
        .get('/api/v1/crm/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'no-es',
          'hub.challenge': 'x',
        })
        .set('Host', TEST_TENANT.host);

      expect(res.status).toBe(403);
    });

    it('sin mode=subscribe tampoco', async () => {
      const res = await ctx.request
        .get('/api/v1/crm/whatsapp/webhook')
        .query({ 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'x' })
        .set('Host', TEST_TENANT.host);

      expect(res.status).toBe(403);
    });
  });

  // ── Autenticidad ──────────────────────────────────────────────────────────

  describe('la firma', () => {
    it('una entrega firmada se guarda como crudo, sin procesar', async () => {
      const wamid = `wamid.OK-${SUITE}`;
      const res = await postWebhook(
        sobre([{ waba: 'waba-mio', cambios: [cambio(NUM_MIO, wamid)] }]),
      );

      expect(res.status).toBe(200);

      const crudos = await crudosDe(wamid);
      expect(crudos).toHaveLength(1);
      expect(crudos[0]!.external_id).toBe(wamid);
      // La puerta guarda; procesar es la tanda que sigue.
      expect(crudos[0]!.processed_at).toBeNull();
    });

    /**
     * ⚠️ **No se guarda nada.** Guardar el crudo de algo sin firmar dejaría que
     * cualquiera que sepa la URL —que es pública y única para todos los
     * casinos— llene la tabla de un tenant.
     */
    it('con firma inválida: 200, y NO se guarda nada', async () => {
      const wamid = `wamid.MALA-${SUITE}`;
      const res = await postWebhook(
        sobre([{ waba: 'waba-mio', cambios: [cambio(NUM_MIO, wamid)] }]),
        { secreto: 'otra-clave' },
      );

      expect(res.status).toBe(200);
      expect(await crudosDe(wamid)).toHaveLength(0);
    });

    it('sin header de firma: 200, y NO se guarda nada', async () => {
      const wamid = `wamid.SINFIRMA-${SUITE}`;
      const res = await postWebhook(
        sobre([{ waba: 'waba-mio', cambios: [cambio(NUM_MIO, wamid)] }]),
        { firma: '' },
      );

      expect(res.status).toBe(200);
      expect(await crudosDe(wamid)).toHaveLength(0);
    });

    /**
     * ⚠️ **El test que justifica todo este archivo.**
     *
     * La firma se calcula sobre el cuerpo **con acentos escapados**, como lo
     * manda Meta. Si el webhook verificara contra `JSON.stringify(req.body)`,
     * los bytes serían otros y esto fallaría — pero sólo cuando el mensaje trae
     * un acento, o sea **de a ratos y con mensajes de gente real**.
     */
    it('un cuerpo con unicode escapado valida igual (bytes crudos)', async () => {
      const wamid = `wamid.ACENTO-${SUITE}`;
      const crudo =
        `{"object":"whatsapp_business_account","entry":[{"id":"waba-mio","changes":` +
        `[{"field":"messages","value":{"metadata":{"phone_number_id":"${NUM_MIO}"},` +
        `"messages":[{"id":"${wamid}","type":"text","text":{"body":"Mart\\u00edn a\\u00f1o"}}]}}]}]}`;

      const res = await ctx.request
        .post('/api/v1/crm/whatsapp/webhook')
        .set('Host', TEST_TENANT.host)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', firmarComoMeta(crudo, APP_SECRET))
        .send(crudo);

      expect(res.status).toBe(200);
      expect(await crudosDe(wamid)).toHaveLength(1);
    });
  });

  // ── De quién es cada cosa ─────────────────────────────────────────────────

  describe('a qué casino va cada mensaje', () => {
    /**
     * ⚠️ **El test de P4.**
     *
     * Meta puede mandar en una sola entrega mensajes de números distintos, y por
     * D23 esos números pueden ser de **casinos distintos**. Lo que se fija acá
     * es que lo que se guarda esté **recortado**: si el sobre guardado trajera
     * adentro el `change` del otro número, el texto que le escribieron a un
     * casino quedaría en la base de otro. No es un ruteo mal hecho: es una
     * filtración guardada en reposo.
     */
    it('una entrega con dos números guarda sólo el nuestro, y recortado', async () => {
      const mio = `wamid.MIO-${SUITE}`;
      const ajeno = `wamid.AJENO-${SUITE}`;

      const res = await postWebhook(
        sobre([
          { waba: 'waba-mio', cambios: [cambio(NUM_MIO, mio, 'esto es mio')] },
          { waba: 'waba-otro', cambios: [cambio(NUM_AJENO, ajeno, 'esto es de otro')] },
        ]),
      );

      expect(res.status).toBe(200);

      const guardados = await crudosDe(mio);
      expect(guardados).toHaveLength(1);

      const texto = JSON.stringify(guardados[0]!.payload);
      expect(texto).toContain(NUM_MIO);
      // Lo del otro casino NO puede estar en esta base.
      expect(texto).not.toContain(NUM_AJENO);
      expect(texto).not.toContain('esto es de otro');
      expect(texto).not.toContain(ajeno);

      // Y el del otro número no se guardó en ningún lado nuestro.
      expect(await crudosDe(ajeno)).toHaveLength(0);
    });

    it('un número que no vinculó nadie: 200 y nada guardado', async () => {
      const wamid = `wamid.NADIE-${SUITE}`;
      const res = await postWebhook(
        sobre([{ waba: 'waba-otro', cambios: [cambio(NUM_AJENO, wamid)] }]),
      );

      expect(res.status).toBe(200);
      expect(await crudosDe(wamid)).toHaveLength(0);
    });

    /**
     * Al desvincular un número, Meta puede seguir mandando un rato. La fila
     * queda inactiva —no borrada— justamente para poder descartar esos mensajes
     * sabiendo por qué, en vez de verlos como un número desconocido.
     */
    it('un número desvinculado no recibe más', async () => {
      const wamid = `wamid.INACTIVO-${SUITE}`;
      const res = await postWebhook(
        sobre([{ waba: 'waba-mio', cambios: [cambio(NUM_INACTIVO, wamid)] }]),
      );

      expect(res.status).toBe(200);
      expect(await crudosDe(wamid)).toHaveLength(0);
    });
  });

  // ── Siempre 200 ───────────────────────────────────────────────────────────

  describe('nada le dice a Meta que reintente', () => {
    it.each([
      ['un cuerpo vacío', {}],
      ['un sobre sin entry', { object: 'whatsapp_business_account' }],
      ['una entry sin changes', { entry: [{ id: 'w' }] }],
      ['un change sin phone_number_id', { entry: [{ id: 'w', changes: [{ value: {} }] }] }],
    ])('%s responde 200', async (_caso, body) => {
      const res = await postWebhook(body);
      expect(res.status).toBe(200);
    });
  });
});
