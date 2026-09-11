/**
 * E2E: servir archivos del disco local (`GET /storage/files/<key>`).
 *
 * ## Por qué existe este archivo
 *
 * El 2026-09-10 llegó a staging la primera nota de voz por Telegram. Se bajó
 * bien, se validó bien y se guardó bien — y **el reproductor no sonaba**, sin un
 * solo error ni en la pantalla ni en la consola.
 *
 * Eran dos cosas de este controlador, las dos invisibles:
 *
 * 1. **`guessMime` no conocía audio.** Un `.ogg` devolvía `null` y el archivo
 *    salía **sin `Content-Type`**. Las imágenes no lo notaron porque ya estaban
 *    en la lista; el audio entró con el 3.5 y acá no se sumó nada.
 * 2. **No había `Content-Length` ni `Range`.** Un `<audio>` pide rangos y
 *    necesita el largo para calcular la duración. Sin eso se dibuja el
 *    reproductor, se queda en `0:00 / 0:00` y no arranca.
 *
 * Lo que se fija acá es **lo que el navegador necesita para reproducir**, no que
 * el archivo se devuelva. Devolverlo ya funcionaba.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootstrapTestApp, type TestApp } from '../helpers/bootstrap-test-app';
import { TEST_TENANT } from '../setup/test-tenant';

const SUITE = Date.now().toString(36);
const raiz = resolve(tmpdir(), `casino-storage-${SUITE}`);

let ctx: TestApp;

/** Deja un archivo en el disco que sirve el controlador y devuelve su key. */
async function archivo(nombre: string, contenido: Buffer): Promise<string> {
  const key = `tenants/${TEST_TENANT.slug}/chat/attachments/${nombre}`;
  const destino = join(raiz, key);
  await fs.mkdir(join(destino, '..'), { recursive: true });
  await fs.writeFile(destino, contenido);
  return key;
}

function pedir(key: string) {
  return ctx.request.get(`/storage/files/${key}`).set('Host', TEST_TENANT.host);
}

describe('storage · servir archivos del disco', () => {
  /** 300 bytes reconocibles, para poder comprobar los rangos byte a byte. */
  const CUERPO = Buffer.from(
    Array.from({ length: 300 }, (_, i) => i % 256),
  );

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_ROOT = raiz;
    ctx = await bootstrapTestApp();
  }, 60_000);

  afterAll(async () => {
    await ctx.close();
    await fs.rm(raiz, { recursive: true, force: true });
  });

  /**
   * ⚠️ **El bug que dejó una nota de voz muda.** Sin `Content-Type` el navegador
   * no adivina para media: directamente no la reproduce.
   */
  describe('Content-Type por extensión', () => {
    it.each([
      ['nota.ogg', 'audio/ogg'],
      ['nota.opus', 'audio/ogg'],
      ['audio.mp3', 'audio/mpeg'],
      ['memo.m4a', 'audio/mp4'],
      ['viejo.amr', 'audio/amr'],
      ['foto.jpg', 'image/jpeg'],
      ['comprobante.pdf', 'application/pdf'],
    ])('%s → %s', async (nombre, esperado) => {
      const key = await archivo(`${SUITE}-${nombre}`, CUERPO);
      const res = await pedir(key);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain(esperado);
    });
  });

  /**
   * ⚠️ **La otra mitad.** Un `<audio>` necesita el largo para saber la duración
   * y pide rangos para reproducir. Sin esto el reproductor queda en `0:00/0:00`.
   */
  describe('lo que el reproductor necesita', () => {
    it('dice el largo y que acepta rangos', async () => {
      const key = await archivo(`${SUITE}-largo.ogg`, CUERPO);
      const res = await pedir(key);

      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-length']).toBe(String(CUERPO.length));
    });

    it('un rango devuelve 206 con exactamente esos bytes', async () => {
      const key = await archivo(`${SUITE}-rango.ogg`, CUERPO);
      const res = await pedir(key).set('Range', 'bytes=10-19');

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 10-19/${CUERPO.length}`);
      expect(res.headers['content-length']).toBe('10');
      expect(Buffer.from(res.body as Buffer).equals(CUERPO.subarray(10, 20))).toBe(true);
    });

    it('un rango abierto llega hasta el final', async () => {
      const key = await archivo(`${SUITE}-abierto.ogg`, CUERPO);
      const res = await pedir(key).set('Range', 'bytes=290-');

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 290-299/${CUERPO.length}`);
    });

    /**
     * `bytes=-50` son los **últimos** 50 bytes, no los primeros. Leerlo al revés
     * devuelve el pedazo equivocado sin que nada falle — el peor tipo de bug.
     */
    it('un sufijo devuelve los ÚLTIMOS bytes, no los primeros', async () => {
      const key = await archivo(`${SUITE}-sufijo.ogg`, CUERPO);
      const res = await pedir(key).set('Range', 'bytes=-50');

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 250-299/${CUERPO.length}`);
      expect(Buffer.from(res.body as Buffer).equals(CUERPO.subarray(250))).toBe(true);
    });

    /**
     * Un rango fuera del archivo es **416**, no un 200 con otra cosa: devolver
     * bytes distintos a los pedidos rompe al cliente de la forma más difícil de
     * depurar.
     */
    it('un rango fuera del archivo devuelve 416 con el largo real', async () => {
      const key = await archivo(`${SUITE}-fuera.ogg`, CUERPO);
      const res = await pedir(key).set('Range', 'bytes=5000-6000');

      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe(`bytes */${CUERPO.length}`);
    });

    it('un Range que no se entiende manda el archivo entero', async () => {
      const key = await archivo(`${SUITE}-raro.ogg`, CUERPO);
      const res = await pedir(key).set('Range', 'cosas=1-2');

      expect(res.status).toBe(200);
      expect(res.headers['content-length']).toBe(String(CUERPO.length));
    });
  });

  it('un HEAD trae los headers y ningún cuerpo', async () => {
    const key = await archivo(`${SUITE}-head.ogg`, CUERPO);
    const res = await ctx.request
      .head(`/storage/files/${key}`)
      .set('Host', TEST_TENANT.host);

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(CUERPO.length));
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('lo que no existe sigue siendo 404', async () => {
    const res = await pedir(`tenants/${TEST_TENANT.slug}/chat/attachments/no.ogg`);
    expect(res.status).toBe(404);
  });

  /** El freno de path-traversal no se toca: se comprueba que siga ahí. */
  it('no se puede salir del root', async () => {
    const res = await ctx.request
      .get('/storage/files/../../../etc/passwd')
      .set('Host', TEST_TENANT.host);
    expect([400, 404]).toContain(res.status);
  });
});
