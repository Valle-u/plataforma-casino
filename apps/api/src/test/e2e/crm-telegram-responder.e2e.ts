/**
 * E2E: la respuesta del operador saliendo por Telegram (**2.7**).
 *
 * Cierra el hueco de la etapa 2: el operador **recibía y no podía contestar**.
 *
 * ## Qué se prueba y qué no
 *
 * Se prueba el servicio de salida, que es donde vive todo lo que puede salir
 * mal: resolver el canal y el chat, abrir el token cifrado, mandar, y anotar el
 * resultado sobre el mensaje ya guardado.
 *
 * **No se prueba el gateway.** La respuesta del operador entra por socket.io y
 * la suite no tiene cliente de sockets; montarlo —handshake, JWT, rooms— es
 * bastante más máquina que lo que agregaría. La glue del gateway es de tres
 * líneas y llama a esto.
 *
 * Telegram va simulado, por lo mismo que en `crm-telegram-vincular`: pegarle de
 * verdad ataría la suite a una red externa, y el caso de "Telegram rechaza"
 * —que es la mitad del valor de este archivo— no se podría provocar.
 *
 * ## Lo que se fija
 *
 * - Que el texto salga **al chat correcto**, con el token del canal.
 * - Que un rechazo de Telegram **no tire**: el mensaje ya está guardado y ya se
 *   le mostró al operador. Lo único que corresponde es anotar por qué no llegó.
 * - Que "entregado" y "no llegó" sean **excluyentes** en la base, que es lo que
 *   hace legible el estado de un mensaje.
 */

import { sql } from 'drizzle-orm';
import { loginAsAdmin } from '../helpers/auth';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { createTestUser, type TestUser } from '../helpers/test-users';
import { TelegramApiService } from '../../chat/telegram/telegram-api.service';
import { TelegramOutboundService } from '../../chat/telegram/telegram-outbound.service';
import { ChatService } from '../../chat/chat.service';
import { StorageService } from '../../storage/storage.service';
import type { ChatAttachment } from '../../chat/chat.types';
import { cifrar } from '../../common/secreto-cifrado';

const SUITE = `tgout-${Date.now().toString(36)}`;
const TOKEN = '7891234567:AAF-xYzAbCdEfGhIjKlMnOpQrStUvWxYz12';

const telegramFalso = { sendMessage: jest.fn(), sendDocument: jest.fn() };

/**
 * El adjunto no se stubea: se stubea **de dónde salen sus bytes**.
 *
 * `getUrl` devuelve una `data:` URL —que `fetch` sabe resolver— así que todo el
 * camino real corre de verdad: la descarga, el control de tamaño y el `Buffer`
 * que termina en el multipart. Lo único simulado es el bucket, que en la suite
 * no tiene los archivos.
 */
const BYTES = Buffer.from('%PDF-1.4 un comprobante de prueba');

/** Un adjunto como los que devuelve `postMessage`, ya saneado. */
function adjunto(name: string, mime = 'application/pdf'): ChatAttachment {
  return {
    storageKey: `tenants/test/chat/attachments/${name}`,
    mime,
    sizeBytes: BYTES.byteLength,
    name,
    kind: mime === 'application/pdf' ? 'pdf' : 'image',
  };
}

let ctx: TestApp;
let adminToken = '';
let litoral: TestUser;
let salida: TelegramOutboundService;
let chat: ChatService;

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

/** Un canal de Telegram de la bandeja de `owner`, con su token cifrado. */
async function crearCanal(owner: string | null, activo = true): Promise<string> {
  const fila = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_channels (type, owner_user_id, config, is_active)
          VALUES ('telegram', ${owner}::uuid,
                  ${JSON.stringify({ token: cifrar(TOKEN), username: 'bot_test' })}::jsonb,
                  ${activo})
          RETURNING id`,
    ),
  );
  return fila.id;
}

/** Un canal del widget web, para el caso de "esto NO sale por Telegram". */
async function crearCanalWeb(): Promise<string> {
  const fila = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_channels (type, owner_user_id, config, is_active)
          VALUES ('web', NULL, '{}'::jsonb, true)
          RETURNING id`,
    ),
  );
  return fila.id;
}

/** Un contacto con su chat de Telegram, y una conversación abierta en `canal`. */
async function crearConversacion(
  canalId: string,
  chatId: string | null,
): Promise<string> {
  const atributos = chatId
    ? JSON.stringify({ telegram: { chatId, username: 'juanp' } })
    : '{}';
  const contacto = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_contacts (display_name, attributes)
          VALUES ('Juan Pérez', ${atributos}::jsonb)
          RETURNING id`,
    ),
  );
  const conv = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_conversations (contact_id, channel_id, status)
          VALUES (${contacto.id}::uuid, ${canalId}::uuid, 'open')
          RETURNING id`,
    ),
  );
  return conv.id;
}

/**
 * Borra la cadena entera del CRM, **de la punta hacia la raíz**.
 *
 * El orden no es estético: `crm_raw_events.channel_id` y
 * `crm_conversations.channel_id` son `RESTRICT`, así que un canal con algo
 * colgando no se puede borrar. Al revés, el fallo aparece en la suite
 * siguiente y lejos de su causa.
 */
async function limpiar(): Promise<void> {
  await ctx.tenantDb.execute(sql`DELETE FROM crm_raw_events`);
  await ctx.tenantDb.execute(sql`DELETE FROM crm_messages`);
  await ctx.tenantDb.execute(sql`DELETE FROM crm_conversations`);
  await ctx.tenantDb.execute(sql`DELETE FROM crm_contacts`);
  await ctx.tenantDb.execute(sql`DELETE FROM crm_channels`);
}

async function mensaje(id: string) {
  return una<{
    body: string;
    delivered_at: Date | null;
    delivery_error: string | null;
    channel_message_id: string | null;
  }>(
    await ctx.tenantDb.execute(
      sql`SELECT body, delivered_at, delivery_error, channel_message_id
            FROM crm_messages WHERE id = ${id}::uuid`,
    ),
  );
}

describe('CRM · responder por Telegram', () => {
  beforeAll(async () => {
    // Antes de levantar la app: sin clave, `cifrar()` tira a propósito (D20).
    process.env.CHANNEL_SECRET_KEY = 'b'.repeat(64);

    ctx = await bootstrapTestApp();

    const tg = ctx.app.get(TelegramApiService);
    jest
      .spyOn(tg, 'sendMessage')
      .mockImplementation((...a) => telegramFalso.sendMessage(...a));
    jest
      .spyOn(tg, 'sendDocument')
      .mockImplementation((...a) => telegramFalso.sendDocument(...a));

    // El bucket de la suite no tiene los archivos: se le da una `data:` URL y
    // el resto del camino —fetch, tope de tamaño, Buffer— corre de verdad.
    jest
      .spyOn(ctx.app.get(StorageService), 'getUrl')
      .mockResolvedValue(
        `data:application/pdf;base64,${BYTES.toString('base64')}`,
      );

    salida = ctx.app.get(TelegramOutboundService);
    chat = ctx.app.get(ChatService);

    adminToken = await loginAsAdmin(ctx.request);
    litoral = await createTestUser(ctx.request, adminToken, {
      suite: SUITE, label: 'litoral', role: 'socio',
    });
    await ctx.tenantDb.execute(
      sql`UPDATE users SET is_independent_branch = true WHERE id = ${litoral.id}`,
    );
  }, 60_000);

  afterAll(async () => {
    // ⚠️ **Limpiar al salir, no sólo al entrar.**
    //
    // El `beforeEach` limpia antes de cada test, así que al terminar el ÚLTIMO
    // quedan sus filas puestas. `crm_conversations.channel_id` es `RESTRICT`:
    // la próxima suite que intente borrar un canal de Telegram —
    // `crm-telegram-vincular` lo hace en su `beforeEach`— se cae, y se cae en
    // catorce tests que no tienen nada que ver con esto.
    //
    // Pasó de verdad en la corrida completa: verde en aislamiento, catorce
    // rojos en la suite entera.
    await limpiar();
    await ctx.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    telegramFalso.sendMessage.mockResolvedValue('4242');
    telegramFalso.sendDocument.mockResolvedValue('4343');
    await limpiar();
  });

  // ── Por dónde sale ────────────────────────────────────────────────────────

  it('una conversación de Telegram se reconoce como canal externo', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555001');
    expect(await salida.canalExterno(ctx.tenantDb, conv)).toEqual({
      tipo: 'telegram',
    });
  });

  /**
   * El widget web **no** es un canal externo: ahí "mandar" es emitir por
   * socket.io a alguien que está del otro lado en ese momento. Si esto
   * devolviera algo, el gateway intentaría mandar por un bot que no existe y
   * marcaría como fallado un mensaje que llegó perfecto.
   */
  it('una conversación del widget web NO sale por Telegram', async () => {
    const conv = await crearConversacion(await crearCanalWeb(), null);
    expect(await salida.canalExterno(ctx.tenantDb, conv)).toBeNull();
  });

  // ── El envío ──────────────────────────────────────────────────────────────

  it('el texto sale al chat de esa persona, con el token del canal', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555002');

    const r = await salida.enviar(ctx.tenantDb, {
      conversationId: conv,
      texto: 'ya te cargo las fichas',
    });

    expect(r.entregado).toBe(true);
    expect(telegramFalso.sendMessage).toHaveBeenCalledTimes(1);
    // El token va DESCIFRADO: es lo que prueba que el ciclo de D20 cierra.
    expect(telegramFalso.sendMessage).toHaveBeenCalledWith(
      TOKEN,
      '555002',
      'ya te cargo las fichas',
    );
  });

  /**
   * La clave del mensaje que sale lleva **prefijo propio** (`tg-out:`).
   *
   * El índice único de la migración `0113` está para cortar reintentos de
   * ENTRADA. Si una respuesta pudiera chocar contra un mensaje entrante, el
   * choque **haría perder lo que escribió el operador** — y separarlos no
   * cuesta nada.
   */
  it('la clave del mensaje que sale no puede chocar con uno que entra', async () => {
    const canal = await crearCanal(litoral.id);
    const conv = await crearConversacion(canal, '555003');

    const r = await salida.enviar(ctx.tenantDb, { conversationId: conv, texto: 'hola' });

    expect(r.channelMessageId).toBe(`tg-out:${canal}:555003:4242`);
    expect(r.channelMessageId).not.toContain(`tg:${canal}:`);
  });

  // ── Cuando no llega ───────────────────────────────────────────────────────

  /**
   * ⚠️ **El test que justifica toda la columna `delivery_error`.**
   *
   * Si un rechazo de Telegram tirara, el operador vería un error genérico y su
   * mensaje quedaría en el hilo igual —ya está guardado— indistinguible de uno
   * entregado. Le estaría escribiendo a nadie sin saberlo.
   */
  it('si Telegram rechaza, no tira: devuelve el motivo tal como lo explicó', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555004');
    telegramFalso.sendMessage.mockRejectedValue(
      Object.assign(new Error('rechazo'), {
        getResponse: () => ({
          message: 'Telegram rechazó la operación: Forbidden: bot was blocked by the user',
        }),
      }),
    );

    const r = await salida.enviar(ctx.tenantDb, { conversationId: conv, texto: 'hola' });

    expect(r.entregado).toBe(false);
    expect(r.error).toContain('bot was blocked by the user');
  });

  it('con el bot desvinculado no se intenta mandar, y se dice por qué', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id, false), '555005');

    const r = await salida.enviar(ctx.tenantDb, { conversationId: conv, texto: 'hola' });

    expect(r.entregado).toBe(false);
    expect(r.error).toMatch(/desvinculado/i);
    expect(telegramFalso.sendMessage).not.toHaveBeenCalled();
  });

  it('sin chat de Telegram en el contacto tampoco se intenta', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), null);

    const r = await salida.enviar(ctx.tenantDb, { conversationId: conv, texto: 'hola' });

    expect(r.entregado).toBe(false);
    expect(telegramFalso.sendMessage).not.toHaveBeenCalled();
  });

  // ── Archivos (2.8) ────────────────────────────────────────────────────────

  /**
   * ⚠️ **Siempre `sendDocument`, nunca `sendPhoto`.**
   *
   * `sendPhoto` recomprime del lado de Telegram. En un comprobante eso puede
   * dejar ilegible un CBU o un monto, y son documentos financieros. El precio
   * es que el jugador lo ve como adjunto y no como foto inline.
   */
  it('una imagen sale como archivo, sin pasar por sendPhoto', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555010');

    const r = await salida.enviar(ctx.tenantDb, {
      conversationId: conv,
      texto: '',
      adjuntos: [adjunto('comprobante.jpg', 'image/jpeg')],
    });

    expect(r.entregado).toBe(true);
    expect(telegramFalso.sendDocument).toHaveBeenCalledTimes(1);
    expect(telegramFalso.sendDocument).toHaveBeenCalledWith(
      TOKEN,
      '555010',
      expect.objectContaining({ nombre: 'comprobante.jpg', mime: 'image/jpeg' }),
    );
  });

  /**
   * El texto va en su **propio** mensaje y no como `caption` del archivo: el
   * caption se corta en 1024 caracteres, y una respuesta cortada por la mitad
   * es peor que dos globos.
   */
  it('con texto y archivo salen los dos, el texto primero', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555011');

    const r = await salida.enviar(ctx.tenantDb, {
      conversationId: conv,
      texto: 'te mando el comprobante',
      adjuntos: [adjunto('c.pdf', 'application/pdf')],
    });

    expect(r.entregado).toBe(true);
    expect(telegramFalso.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegramFalso.sendDocument).toHaveBeenCalledTimes(1);
    // El orden importa: el texto explica el archivo que viene atrás.
    const tTexto = telegramFalso.sendMessage.mock.invocationCallOrder[0]!;
    const tArchivo = telegramFalso.sendDocument.mock.invocationCallOrder[0]!;
    expect(tTexto).toBeLessThan(tArchivo);
  });

  it('varios archivos salen todos, en orden', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555012');

    const r = await salida.enviar(ctx.tenantDb, {
      conversationId: conv,
      texto: '',
      adjuntos: [adjunto('uno.pdf'), adjunto('dos.pdf'), adjunto('tres.pdf')],
    });

    expect(r.entregado).toBe(true);
    expect(
      telegramFalso.sendDocument.mock.calls.map(
        (c) => (c[2] as { nombre: string }).nombre,
      ),
    ).toEqual(['uno.pdf', 'dos.pdf', 'tres.pdf']);
  });

  /**
   * ⚠️ **Un envío puede fallar por la mitad**, porque son varias llamadas a
   * Telegram para una sola fila. Si el motivo no dijera qué alcanzó a salir, el
   * operador lo mandaría de nuevo entero y el jugador recibiría el texto dos
   * veces.
   */
  it('si falla el archivo, el motivo dice que el texto sí salió', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555013');
    telegramFalso.sendDocument.mockRejectedValue(
      Object.assign(new Error('x'), {
        getResponse: () => ({ message: 'Bad Request: file is too big' }),
      }),
    );

    const r = await salida.enviar(ctx.tenantDb, {
      conversationId: conv,
      texto: 'ahí va',
      adjuntos: [adjunto('grande.pdf')],
    });

    expect(r.entregado).toBe(false);
    expect(telegramFalso.sendMessage).toHaveBeenCalledTimes(1);
    expect(r.error).toMatch(/una parte/i);
    expect(r.error).toContain('file is too big');
  });

  it('un mensaje sin texto ni archivos no sale', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555014');

    const r = await salida.enviar(ctx.tenantDb, { conversationId: conv, texto: '   ' });

    expect(r.entregado).toBe(false);
    expect(telegramFalso.sendMessage).not.toHaveBeenCalled();
    expect(telegramFalso.sendDocument).not.toHaveBeenCalled();
  });

  // ── Lo que queda anotado en el mensaje ────────────────────────────────────

  it('entregado deja la marca y la clave del proveedor, sin error', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555006');
    const msg = await chat.postMessage(ctx.tenantDb, {
      conversationId: conv,
      direction: 'outbound',
      senderUserId: litoral.id,
      body: 'listo',
    });

    const envio = await salida.enviar(ctx.tenantDb, { conversationId: conv, texto: 'listo' });
    await chat.marcarEntrega(ctx.tenantDb, msg.id, envio);

    const fila = await mensaje(msg.id);
    expect(fila.delivered_at).not.toBeNull();
    expect(fila.delivery_error).toBeNull();
    expect(fila.channel_message_id).toContain('tg-out:');
  });

  /**
   * Los dos campos son **excluyentes**: es lo que hace que el estado de un
   * mensaje se pueda leer de un vistazo, en la base y en el panel.
   */
  it('no entregado deja el motivo y NINGUNA marca de entrega', async () => {
    const conv = await crearConversacion(await crearCanal(litoral.id), '555007');
    const msg = await chat.postMessage(ctx.tenantDb, {
      conversationId: conv,
      direction: 'outbound',
      senderUserId: litoral.id,
      body: 'no va a llegar',
    });
    telegramFalso.sendMessage.mockRejectedValue(
      Object.assign(new Error('x'), {
        getResponse: () => ({ message: 'Forbidden: bot was blocked by the user' }),
      }),
    );

    const envio = await salida.enviar(ctx.tenantDb, {
      conversationId: conv,
      texto: 'no va a llegar',
    });
    await chat.marcarEntrega(ctx.tenantDb, msg.id, envio);

    const fila = await mensaje(msg.id);
    expect(fila.delivered_at).toBeNull();
    expect(fila.delivery_error).toContain('blocked by the user');
    // El mensaje NO se borra: el operador tiene que ver qué escribió.
    expect(fila.body).toBe('no va a llegar');
  });
});
