/**
 * E2E: la retención de adjuntos del chat (**D15**, roadmap **4.1**).
 *
 * ## Por qué esto se prueba contra el storage de verdad y no con un mock
 *
 * Porque lo que hay que probar **no es que el código llame a `delete()`**: es
 * que el archivo **ya no esté**. El roadmap avisa que el borrado en el bucket es
 * nuevo —antes sólo escribía un warning mientras los archivos se acumulaban— así
 * que un mock que devuelve `true` probaría exactamente la parte que no importa.
 *
 * Acá se sube un archivo con el storage configurado (en test, disco local), se
 * corre la purga, y se comprueba que **pedirlo devuelve error**.
 *
 * ## Lo que se fija
 *
 * - Un adjunto de hace más de 6 meses **se borra**, y el mensaje **queda** con
 *   la marca.
 * - Uno reciente **no se toca**. Es la mitad que más duele si falla.
 * - El simulacro **no borra nada**.
 * - **El cinturón**: una clave que no es de `/chat/attachments/` no se borra
 *   nunca, aunque esté vencida. D15 dice que el comprobante de un depósito es
 *   otro archivo con su propio ciclo de vida.
 * - Idempotencia: correr dos veces no rompe ni recuenta.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { StorageService } from '../../storage/storage.service';
import { RetencionDeAdjuntosService } from '../../chat/retencion-de-adjuntos.service';
import { TEST_TENANT } from '../setup/test-tenant';

const SUITE = Date.now().toString(36);
/** Carpeta propia: la suite borra archivos, y no puede tocar los de nadie más. */
const raizDePrueba = resolve(tmpdir(), `casino-retencion-${SUITE}`);

let ctx: TestApp;
let storage: StorageService;
let retencion: RetencionDeAdjuntosService;
let canalId = '';
let contactoId = '';
let conversacionId = '';

async function una<T>(res: unknown): Promise<T> {
  return (res as unknown as T[])[0]!;
}

/** Sube un archivo de verdad y devuelve su clave. */
async function subir(prefijo: string): Promise<string> {
  const subido = await storage.upload({
    buffer: Buffer.from(`contenido ${Math.random()}`),
    originalName: 'prueba.txt',
    mimeType: 'text/plain',
    keyPrefix: prefijo,
    tenantSlug: TEST_TENANT.slug,
  });
  return subido.storageKey;
}

/**
 * ¿El archivo sigue estando **de verdad**?
 *
 * Se mira el disco, no una respuesta del servicio. Es todo el punto de este
 * archivo: preguntarle al mismo objeto que hace el borrado si borró no prueba
 * nada. En test el driver es `local`, así que la verdad está en el filesystem.
 */
async function existe(storageKey: string): Promise<boolean> {
  try {
    await fs.access(join(raizDePrueba, storageKey));
    return true;
  } catch {
    return false;
  }
}

/** Un mensaje con un adjunto, con la antigüedad que se le pida. */
async function mensajeCon(
  storageKey: string,
  mesesAtras: number,
): Promise<string> {
  const adjuntos = [
    {
      storageKey,
      mime: 'image/jpeg',
      sizeBytes: 1234,
      name: 'comprobante.jpg',
      kind: 'image',
    },
  ];
  const fila = await una<{ id: string }>(
    await ctx.tenantDb.execute(
      sql`INSERT INTO crm_messages (conversation_id, direction, body, attachments, created_at)
          VALUES (${conversacionId}, 'inbound', 'te mando el comprobante',
                  ${JSON.stringify(adjuntos)}::jsonb,
                  now() - (${mesesAtras} || ' months')::interval)
          RETURNING id`,
    ),
  );
  return fila.id;
}

async function adjuntosDe(messageId: string) {
  const fila = await una<{ attachments: unknown }>(
    await ctx.tenantDb.execute(
      sql`SELECT attachments FROM crm_messages WHERE id = ${messageId}`,
    ),
  );
  return fila.attachments as Array<{
    storageKey: string;
    name: string;
    purgedAt?: string;
  }>;
}

describe('CRM · retención de adjuntos (D15)', () => {
  beforeAll(async () => {
    // El driver se elige por env al construir el módulo, así que esto va
    // **antes** del bootstrap. Se fuerza `local` porque el `.env.local` del
    // repo apunta a R2 y acá no hay credenciales — pero sobre todo porque
    // **staging también corre con `local`** (`24-entornos-deploy.md`), así que
    // es el driver contra el que este proceso se va a probar de verdad primero.
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_ROOT = raizDePrueba;

    ctx = await bootstrapTestApp();
    storage = ctx.app.get(StorageService);
    retencion = ctx.app.get(RetencionDeAdjuntosService);

    const canal = await una<{ id: string }>(
      await ctx.tenantDb.execute(
        sql`INSERT INTO crm_channels (type, owner_user_id, is_active, config)
            VALUES ('web-livechat', NULL, true, '{}'::jsonb) RETURNING id`,
      ),
    );
    canalId = canal.id;

    const contacto = await una<{ id: string }>(
      await ctx.tenantDb.execute(
        sql`INSERT INTO crm_contacts (display_name, is_lead)
            VALUES (${`retencion-${SUITE}`}, true) RETURNING id`,
      ),
    );
    contactoId = contacto.id;

    const conv = await una<{ id: string }>(
      await ctx.tenantDb.execute(
        sql`INSERT INTO crm_conversations (contact_id, channel_id, status)
            VALUES (${contactoId}, ${canalId}, 'open') RETURNING id`,
      ),
    );
    conversacionId = conv.id;
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
    await fs.rm(raizDePrueba, { recursive: true, force: true });
  });

  it('un adjunto de hace 8 meses se borra, y el mensaje queda con la marca', async () => {
    const key = await subir('chat/attachments');
    const msgId = await mensajeCon(key, 8);
    expect(await existe(key)).toBe(true);

    const res = await retencion.purgar(ctx.tenantDb);

    expect(res.borrados).toBeGreaterThanOrEqual(1);
    expect(res.fallados).toBe(0);
    expect(res.omitidos).toBe(0);

    // El archivo ya no está: esto es lo que el mock no probaría.
    expect(await existe(key)).toBe(false);

    // Y el mensaje sigue, con la marca y el nombre.
    const adjuntos = await adjuntosDe(msgId);
    expect(adjuntos).toHaveLength(1);
    expect(adjuntos[0]!.purgedAt).toBeTruthy();
    expect(adjuntos[0]!.name).toBe('comprobante.jpg');

    const cuerpo = await una<{ body: string }>(
      await ctx.tenantDb.execute(
        sql`SELECT body FROM crm_messages WHERE id = ${msgId}`,
      ),
    );
    expect(cuerpo.body).toBe('te mando el comprobante');
  });

  /**
   * ⚠️ **La mitad que más duele si falla.** Borrar de más un comprobante de
   * ayer no se deshace, y el operador se entera cuando lo necesita.
   */
  it('un adjunto de hace 2 meses NO se toca', async () => {
    const key = await subir('chat/attachments');
    const msgId = await mensajeCon(key, 2);

    await retencion.purgar(ctx.tenantDb);

    expect(await existe(key)).toBe(true);
    expect((await adjuntosDe(msgId))[0]!.purgedAt).toBeUndefined();
  });

  it('el simulacro cuenta pero no borra nada', async () => {
    const key = await subir('chat/attachments');
    const msgId = await mensajeCon(key, 9);

    const res = await retencion.purgar(ctx.tenantDb, { simulacro: true });

    expect(res.borrados).toBeGreaterThanOrEqual(1);
    // Ni el archivo ni la base se tocaron.
    expect(await existe(key)).toBe(true);
    expect((await adjuntosDe(msgId))[0]!.purgedAt).toBeUndefined();
  });

  /**
   * ⚠️ **El cinturón.**
   *
   * D15 dice explícitamente que el comprobante oficial de un depósito
   * (`deposits/proofs/…`) es **otro archivo con su propio ciclo de vida**. Si
   * una clave así apareciera adentro de un mensaje, borrarla sería destruir un
   * documento financiero sin vuelta atrás.
   *
   * Hoy nada mete esa clave en un mensaje. El chequeo existe porque el costo de
   * equivocarse no es un bug, y porque esto va a seguir corriendo mucho después
   * de que nadie recuerde por qué era seguro.
   */
  it('una clave que NO es del chat no se borra, aunque esté vencida', async () => {
    const key = await subir('deposits/proofs');
    const msgId = await mensajeCon(key, 10);

    const res = await retencion.purgar(ctx.tenantDb);

    expect(res.omitidos).toBeGreaterThanOrEqual(1);
    // Sigue ahí, y sin marcar.
    expect(await existe(key)).toBe(true);
    expect((await adjuntosDe(msgId))[0]!.purgedAt).toBeUndefined();
  });

  it('correr dos veces no rompe ni vuelve a contar lo ya borrado', async () => {
    const key = await subir('chat/attachments');
    await mensajeCon(key, 7);

    const primera = await retencion.purgar(ctx.tenantDb);
    expect(primera.borrados).toBeGreaterThanOrEqual(1);

    const segunda = await retencion.purgar(ctx.tenantDb);
    // Lo ya marcado no vuelve a aparecer: sin eso, la consulta traería siempre
    // los mismos mensajes viejos y nunca llegaría a los de más atrás.
    expect(segunda.borrados).toBe(0);
    expect(segunda.fallados).toBe(0);
  });
});
