/**
 * E2E: vincular un bot de Telegram a una bandeja (2.1).
 *
 * ## Telegram va simulado, a propósito
 *
 * Los métodos de `TelegramApiService` se espían. Pegarle a Telegram de verdad
 * ataría la suite a una red externa y a un bot vivo: fallaría los días que
 * Telegram esté lento, y no se podría probar el caso de "Telegram rechaza".
 *
 * Lo que **no** se simula es nada de lo nuestro: el cifrado, la base y los
 * permisos corren de verdad.
 *
 * ## Lo que se fija
 *
 * - **D20** — el token queda **cifrado** en la base y **no vuelve** en ninguna
 *   respuesta. Es la garantía que justifica todo el módulo de secretos.
 * - **D1** — el canal es de la bandeja que lo vinculó, y otra no lo ve.
 * - El **orden**: si `setWebhook` falla, no queda fila colgada.
 */

import { sql } from 'drizzle-orm';
import { TEST_TENANT } from '../setup/test-tenant';
import { loginAs, loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { TelegramApiService } from '../../chat/telegram/telegram-api.service';
import { descifrar, estaCifrado } from '../../common/secreto-cifrado';

const SUITE = `tg-${Date.now().toString(36)}`;
const TOKEN = '7891234567:AAF-xYzAbCdEfGhIjKlMnOpQrStUvWxYz12';
const TOKEN_2 = '1122334455:BBG-qWeRtYuIoPaSdFgHjKlZxCvBnM98';

/**
 * El doble de Telegram.
 *
 * Se espía la instancia REAL que levanta Nest en vez de reemplazar el provider:
 * `bootstrapTestApp` usa `NestFactory.create` directo —no el builder de
 * testing— así que no admite overrides, y no vale la pena cambiarle la forma a
 * un helper que usan noventa suites por un caso.
 */
const telegramFalso = {
  getMe: jest.fn(),
  setWebhook: jest.fn(),
  deleteWebhook: jest.fn(),
};

let ctx: TestApp;
let adminToken = '';
let litoral: TestUser;
let litoralToken = '';

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

function pedir(metodo: 'get' | 'post' | 'delete', ruta: string, bearer: string) {
  return ctx.request[metodo](ruta)
    .set('Host', TEST_TENANT.host)
    .set('Authorization', bearer);
}

describe('CRM · vincular un bot de Telegram', () => {
  beforeAll(async () => {
    // La clave de cifrado tiene que estar ANTES de levantar la app: sin ella
    // el endpoint responde CHANNEL_SECRET_KEY_MISSING, que es su propio test.
    process.env.CHANNEL_SECRET_KEY = 'a'.repeat(64);

    ctx = await bootstrapTestApp();

    // Se enchufan los dobles sobre el servicio real ya instanciado.
    const tg = ctx.app.get(TelegramApiService);
    jest.spyOn(tg, 'getMe').mockImplementation((...a) => telegramFalso.getMe(...a));
    jest
      .spyOn(tg, 'setWebhook')
      .mockImplementation((...a) => telegramFalso.setWebhook(...a));
    jest
      .spyOn(tg, 'deleteWebhook')
      .mockImplementation((...a) => telegramFalso.deleteWebhook(...a));
    adminToken = await loginAsAdmin(ctx.request);

    litoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'litoral', role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${litoral.id}`,
    );
    litoralToken = await loginAs(ctx.request, litoral.username, litoral.password);
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    telegramFalso.getMe.mockResolvedValue({
      id: 7891234567,
      username: 'miamihub_bot',
      firstName: 'MIAMI HUB',
    });
    telegramFalso.setWebhook.mockResolvedValue(undefined);
    telegramFalso.deleteWebhook.mockResolvedValue(undefined);
    // ⚠️ **Todo lo que cuelga de un canal se borra ANTES que el canal.**
    //
    // `crm_raw_events.channel_id` y `crm_conversations.channel_id` son los dos
    // `RESTRICT`: borrar un canal que recibió algo, o que tiene una
    // conversación, falla. Esta suite no crea ni crudos ni conversaciones —
    // **pero otra que corrió antes sí**, y el error sale acá, en el `beforeEach`
    // de catorce tests que no tienen nada que ver.
    //
    // Ya pasó dos veces: primero con los crudos, después con las
    // conversaciones que deja `crm-telegram-responder`. Por eso la limpieza es
    // de la cadena entera y no de lo que este archivo usa.
    await ctx.tenantDb.execute(
      sql`DELETE FROM crm_raw_events
           WHERE channel_id IN (SELECT id FROM crm_channels WHERE type = 'telegram')`,
    );
    await ctx.tenantDb.execute(
      sql`DELETE FROM crm_messages
           WHERE conversation_id IN (
             SELECT id FROM crm_conversations
              WHERE channel_id IN (SELECT id FROM crm_channels WHERE type = 'telegram'))`,
    );
    await ctx.tenantDb.execute(
      sql`DELETE FROM crm_conversations
           WHERE channel_id IN (SELECT id FROM crm_channels WHERE type = 'telegram')`,
    );
    await ctx.tenantDb.execute(sql`DELETE FROM crm_channels WHERE type = 'telegram'`);
  });

  // ── Lo que devuelve, y lo que NO ──────────────────────────────────────────

  it('vincula y devuelve el link que el operador le pasa a sus jugadores', async () => {
    const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: TOKEN });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe('miamihub_bot');
    expect(res.body.link).toBe('https://t.me/miamihub_bot');
    expect(res.body.isActive).toBe(true);
  });

  /**
   * ⚠️ **El test que justifica D20.**
   *
   * El token es la credencial que deja actuar COMO el bot, y por D13 es del
   * socio. No puede salir en una respuesta ni quedar legible en la base.
   */
  it('el token queda CIFRADO en la base y no vuelve en la respuesta', async () => {
    const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: TOKEN });

    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(JSON.stringify(res.body)).not.toContain('AAF-xYz');

    const fila = await una<{ config: { token: string } }>(
      await ctx.tenantDb.execute(
        sql`SELECT config FROM crm_channels WHERE id = ${res.body.id as string}`,
      ),
    );
    expect(estaCifrado(fila.config.token)).toBe(true);
    expect(fila.config.token).not.toContain('AAF-xYz');
    // Y se puede recuperar: cifrado, no destruido.
    expect(descifrar(fila.config.token)).toBe(TOKEN);
  });

  it('el webhook se registra con la URL del casino y un secreto propio', async () => {
    const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: TOKEN });

    expect(telegramFalso.setWebhook).toHaveBeenCalledTimes(1);
    const [tokenUsado, url, secreto] = telegramFalso.setWebhook.mock.calls[0]!;

    expect(tokenUsado).toBe(TOKEN);
    expect(url).toContain(`/api/v1/crm/telegram/webhook/${TEST_TENANT.slug}/`);
    expect(url).toContain(res.body.id as string);
    // 32 bytes en hex. Es lo único que autentica los updates entrantes.
    expect(secreto).toMatch(/^[0-9a-f]{64}$/);

    const fila = await una<{ webhook_secret: string }>(
      await ctx.tenantDb.execute(
        sql`SELECT webhook_secret FROM crm_channels WHERE id = ${res.body.id as string}`,
      ),
    );
    expect(fila.webhook_secret).toBe(secreto);
  });

  // ── El orden de las operaciones ───────────────────────────────────────────

  /**
   * Si Telegram no acepta la URL, no puede quedar una fila que nunca va a
   * recibir nada — y menos marcada como activa.
   */
  it('si setWebhook falla, no queda fila colgada', async () => {
    telegramFalso.setWebhook.mockRejectedValue(new Error('Bad webhook'));

    const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: TOKEN });

    expect(res.status).toBeGreaterThanOrEqual(400);

    const n = await una<{ n: string }>(
      await ctx.tenantDb.execute(
        sql`SELECT count(*)::text AS n FROM crm_channels WHERE type = 'telegram'`,
      ),
    );
    expect(Number(n.n)).toBe(0);
  });

  it('valida el token ANTES de guardarlo', async () => {
    telegramFalso.getMe.mockRejectedValue(new Error('Unauthorized'));

    const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: TOKEN });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(telegramFalso.setWebhook).not.toHaveBeenCalled();
  });

  it('un token con forma inválida ni siquiera llega a Telegram', async () => {
    const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: '@miamihub_bot' });

    expect(res.status).toBe(400);
    expect(telegramFalso.getMe).not.toHaveBeenCalled();
  });

  it('el mismo bot no se puede vincular dos veces', async () => {
    await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: TOKEN });

    const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: TOKEN });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('BOT_ALREADY_LINKED');
  });

  // ── D1: el canal es de una bandeja ────────────────────────────────────────

  describe('D1 · el canal pertenece a un panel', () => {
    it('el canal queda a nombre de quien lo vinculó', async () => {
      const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
        .send({ token: TOKEN });

      const fila = await una<{ owner_user_id: string | null }>(
        await ctx.tenantDb.execute(
          sql`SELECT owner_user_id FROM crm_channels WHERE id = ${res.body.id as string}`,
        ),
      );
      expect(fila.owner_user_id).toBe(litoral.id);
    });

    it('el canal del casino queda como central (owner NULL)', async () => {
      const res = await pedir('post', '/tenant/chat/channels/telegram', adminToken)
        .send({ token: TOKEN_2 });

      const fila = await una<{ owner_user_id: string | null }>(
        await ctx.tenantDb.execute(
          sql`SELECT owner_user_id FROM crm_channels WHERE id = ${res.body.id as string}`,
        ),
      );
      expect(fila.owner_user_id).toBeNull();
    });

    it('una bandeja NO ve los canales de la otra', async () => {
      await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
        .send({ token: TOKEN });
      telegramFalso.getMe.mockResolvedValue({
        id: 1122334455, username: 'casino_bot', firstName: 'Casino',
      });
      await pedir('post', '/tenant/chat/channels/telegram', adminToken)
        .send({ token: TOKEN_2 });

      const deLitoral = await pedir('get', '/tenant/chat/channels/telegram', litoralToken);
      const delCasino = await pedir('get', '/tenant/chat/channels/telegram', adminToken);

      expect(deLitoral.body).toHaveLength(1);
      expect(deLitoral.body[0].username).toBe('miamihub_bot');
      expect(delCasino.body).toHaveLength(1);
      expect(delCasino.body[0].username).toBe('casino_bot');
    });

    it('no se puede desvincular el canal de otra bandeja', async () => {
      const res = await pedir('post', '/tenant/chat/channels/telegram', adminToken)
        .send({ token: TOKEN });

      const borrar = await pedir(
        'delete',
        `/tenant/chat/channels/telegram/${res.body.id as string}`,
        litoralToken,
      );

      // 404 y no 403: un 403 confirmaría que ese canal existe en otro lado.
      expect(borrar.status).toBe(404);
      expect(telegramFalso.deleteWebhook).not.toHaveBeenCalled();
    });
  });

  // ── Desvincular ───────────────────────────────────────────────────────────

  it('desvincular corta el webhook y desactiva, sin borrar la fila', async () => {
    const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: TOKEN });
    const id = res.body.id as string;

    const borrar = await pedir(
      'delete', `/tenant/chat/channels/telegram/${id}`, litoralToken,
    );

    expect(borrar.status).toBe(204);
    expect(telegramFalso.deleteWebhook).toHaveBeenCalledWith(TOKEN);

    // La fila SIGUE: las conversaciones que entraron por este canal apuntan a
    // él. Borrarla sería borrar la historia de lo que se habló.
    const fila = await una<{ is_active: boolean }>(
      await ctx.tenantDb.execute(
        sql`SELECT is_active FROM crm_channels WHERE id = ${id}`,
      ),
    );
    expect(fila.is_active).toBe(false);
  });

  it('si Telegram no contesta al desvincular, el canal se desactiva igual', async () => {
    const res = await pedir('post', '/tenant/chat/channels/telegram', litoralToken)
      .send({ token: TOKEN });
    telegramFalso.deleteWebhook.mockRejectedValue(new Error('timeout'));

    const borrar = await pedir(
      'delete', `/tenant/chat/channels/telegram/${res.body.id as string}`, litoralToken,
    );

    // Que Telegram esté caído no puede dejar el canal prendido de este lado.
    expect(borrar.status).toBe(204);
    const fila = await una<{ is_active: boolean }>(
      await ctx.tenantDb.execute(
        sql`SELECT is_active FROM crm_channels WHERE id = ${res.body.id as string}`,
      ),
    );
    expect(fila.is_active).toBe(false);
  });

  // ── Quién puede ───────────────────────────────────────────────────────────

  it('un operador de la red dependiente no llega ni a la lista', async () => {
    const cajero = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'cajdep', role: 'cajero',
    });
    const token = await loginAs(ctx.request, cajero.username, cajero.password);

    const res = await pedir('get', '/tenant/chat/channels/telegram', token);
    expect(res.status).toBe(403);
  });
});
