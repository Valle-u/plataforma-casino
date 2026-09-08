/**
 * Firma de las URLs de comprobantes (`CloudflareWorkerDriver.getUrl`).
 *
 * Lo que se protege acá: los comprobantes son documentos financieros y hasta el
 * 2026-09-06 se servían en una URL pública sin vencimiento. La firma es lo que
 * los cierra, así que estas reglas no son de estilo:
 *
 *   - Se firma la key **y** el vencimiento juntos. Firmar sólo el vencimiento
 *     dejaría reusar una firma válida para cualquier otro archivo.
 *   - La marca (logos, hero) NO se firma: es pública a propósito y una URL con
 *     vencimiento la rompería en cada caché.
 *   - Sin secreto configurado, se comporta como antes. Es lo que permite
 *     desplegar la API antes que el Worker sin romper nada.
 *
 * El algoritmo tiene que dar **idéntico** al del Worker
 * (`worker/src/index.js`, `validarFirma`), que usa Web Crypto en vez de
 * `node:crypto`. Acá se recalcula a mano el HMAC esperado en vez de llamar al
 * mismo helper del driver: si el test usara la función que prueba, un cambio de
 * algoritmo pasaría desapercibido y el Worker empezaría a rechazar todo.
 */

import { createHmac } from 'node:crypto';
import { CloudflareWorkerDriver } from './cloudflare-worker-driver';

const SECRETO = 'secreto-de-prueba-largo';
const PROOF = 'tenants/miamihub/deposits/proofs/abc-123.pdf';
const MARCA = 'tenants/miamihub/hero/logo.png';
const ADJUNTO_CHAT = 'tenants/miamihub/chat/attachments/def-456.jpg';

function crearDriver(conSecreto: boolean): CloudflareWorkerDriver {
  process.env.CF_WORKER_URL = 'https://worker.test';
  process.env.CF_WORKER_TOKEN = 'token';
  if (conSecreto) process.env.CF_WORKER_SIGNING_SECRET = SECRETO;
  else delete process.env.CF_WORKER_SIGNING_SECRET;
  return new CloudflareWorkerDriver();
}

describe('CloudflareWorkerDriver.getUrl — firma de comprobantes', () => {
  const envOriginal = { ...process.env };
  afterEach(() => {
    process.env = { ...envOriginal };
  });

  it('firma los comprobantes con vencimiento', async () => {
    const url = new URL(await crearDriver(true).getUrl(PROOF));

    expect(url.pathname).toBe(`/files/${PROOF}`);
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);

    // Vence en el futuro y no dentro de un mes: son minutos.
    const ahora = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThan(ahora);
    expect(exp).toBeLessThanOrEqual(ahora + 3600);

    // El HMAC esperado, recalculado aparte.
    const esperado = createHmac('sha256', SECRETO)
      .update(`${PROOF}:${exp}`)
      .digest('hex');
    expect(sig).toBe(esperado);
  });

  it('NO firma la marca: es pública a propósito', async () => {
    const url = await crearDriver(true).getUrl(MARCA);
    expect(url).toBe(`https://worker.test/files/${MARCA}`);
    expect(url).not.toContain('sig=');
  });

  it('sin secreto no firma nada (permite desplegar la API antes que el Worker)', async () => {
    const url = await crearDriver(false).getUrl(PROOF);
    expect(url).toBe(`https://worker.test/files/${PROOF}`);
    expect(url).not.toContain('sig=');
  });

  it('la firma queda atada al ARCHIVO, no sólo al vencimiento', async () => {
    const driver = crearDriver(true);
    const a = new URL(await driver.getUrl(PROOF));
    const otro = 'tenants/miamihub/deposits/proofs/otro-999.pdf';

    // Misma expiración para los dos: lo único que cambia es la key.
    const exp = Number(a.searchParams.get('exp'));
    const firmaDeOtro = createHmac('sha256', SECRETO)
      .update(`${otro}:${exp}`)
      .digest('hex');

    expect(firmaDeOtro).not.toBe(a.searchParams.get('sig'));
  });

  it('respeta el TTL que se le pide', async () => {
    const url = new URL(await crearDriver(true).getUrl(PROOF, 60));
    const exp = Number(url.searchParams.get('exp'));
    const ahora = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThanOrEqual(ahora + 55);
    expect(exp).toBeLessThanOrEqual(ahora + 65);
  });

  /**
   * Los adjuntos del chat entraron a la regla el 2026-09-08. Hasta entonces la
   * carpeta privada era una sola (`/proofs/`) y `chat/attachments` no
   * matcheaba, así que las fotos que mandaba la gente por el livechat —DNI,
   * capturas de transferencias— se servían públicas y con caché de un año.
   *
   * El test importa porque el error original fue exactamente esto: una regla
   * que cubría una carpeta y no la otra, sin nada que lo delatara.
   */
  describe('adjuntos del chat', () => {
    it('los firma, igual que a los comprobantes', async () => {
      const url = new URL(await crearDriver(true).getUrl(ADJUNTO_CHAT));

      expect(url.pathname).toBe(`/files/${ADJUNTO_CHAT}`);
      const exp = Number(url.searchParams.get('exp'));
      const esperado = createHmac('sha256', SECRETO)
        .update(`${ADJUNTO_CHAT}:${exp}`)
        .digest('hex');
      expect(url.searchParams.get('sig')).toBe(esperado);
    });

    it('no confunde la carpeta: "chat" a secas no alcanza', async () => {
      // Sólo `/chat/attachments/` es privada. Una key que apenas contenga la
      // palabra no debe firmarse: si la regla se aflojara a `includes('chat')`,
      // esto empezaría a firmar cosas públicas y nadie lo notaría hasta que un
      // logo dejara de cargar.
      const url = await crearDriver(true).getUrl(
        'tenants/chat-royale/hero/logo.png',
      );
      expect(url).not.toContain('sig=');
    });
  });
});
