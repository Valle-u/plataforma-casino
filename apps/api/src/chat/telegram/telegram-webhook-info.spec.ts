/**
 * Cómo se lee lo que Telegram contesta sobre el webhook de un bot.
 *
 * Sin base. La red va simulada: lo que se fija acá son **las dos conversiones
 * que no son obvias**, y las dos deciden qué le muestra la pantalla al operador
 * cuando algo no anda.
 *
 * 1. **`url: ""` no es una URL vacía: es "no hay webhook".** Telegram devuelve
 *    string vacío, no `null`, cuando el bot no tiene ninguno registrado. Sin
 *    normalizarlo, la pantalla mostraría una URL en blanco —que se lee como un
 *    problema de dibujo— en vez del único cartel que importa: *no va a entrar ni
 *    un mensaje*.
 *
 * 2. **`last_error_date` viene en segundos.** Tratarlo como milisegundos pone el
 *    error en 1970 y lo hace parecer viejo e irrelevante, justo cuando es de
 *    recién.
 */

import { TelegramApiService } from './telegram-api.service';

const TOKEN = '7891234567:AAF-loQueSea';

/** Deja a `fetch` devolviendo lo que Telegram habría contestado. */
function telegramResponde(result: Record<string, unknown>): void {
  globalThis.fetch = jest.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ ok: true, result }),
  }) as unknown as typeof fetch;
}

describe('getWebhookInfo', () => {
  const fetchOriginal = globalThis.fetch;
  let api: TelegramApiService;

  beforeEach(() => {
    api = new TelegramApiService();
  });

  afterAll(() => {
    globalThis.fetch = fetchOriginal;
  });

  it('un webhook sano se lee entero', async () => {
    telegramResponde({
      url: 'https://api-staging.miamihub.vip/api/v1/crm/telegram/webhook/demo/abc',
      pending_update_count: 0,
      ip_address: '203.0.113.10',
    });

    await expect(api.getWebhookInfo(TOKEN)).resolves.toEqual({
      url: 'https://api-staging.miamihub.vip/api/v1/crm/telegram/webhook/demo/abc',
      pendientes: 0,
      ip: '203.0.113.10',
      ultimoErrorEn: null,
      ultimoError: null,
    });
  });

  /**
   * ⚠️ **El caso que justifica toda la pantalla.**
   *
   * `setWebhook` acepta cualquier URL HTTPS bien formada sin probarla, así que
   * vincular sale bien y el canal queda mudo. Esto es lo que lo delata: el
   * mensaje de Telegram dice exactamente qué se encontró, y por eso se pasa tal
   * cual y no traducido a "hubo un problema".
   */
  it('trae el error de entrega tal como lo dice Telegram', async () => {
    telegramResponde({
      url: 'https://crm-staging.miamihub.vip/api/v1/crm/telegram/webhook/demo/abc',
      pending_update_count: 3,
      last_error_date: 1_757_540_000,
      last_error_message: 'Wrong response from the webhook: 404 Not Found',
    });

    const info = await api.getWebhookInfo(TOKEN);

    expect(info.ultimoError).toBe('Wrong response from the webhook: 404 Not Found');
    expect(info.pendientes).toBe(3);
    // Segundos, no milisegundos: en ms esto caería en 1970 y el operador leería
    // un error de recién como si fuera de hace medio siglo.
    expect(info.ultimoErrorEn).toEqual(new Date(1_757_540_000_000));
  });

  it('sin webhook registrado, la url es null y no un string vacío', async () => {
    telegramResponde({ url: '', pending_update_count: 0 });

    const info = await api.getWebhookInfo(TOKEN);

    expect(info.url).toBeNull();
  });

  it('sólo espacios tampoco es una url', async () => {
    telegramResponde({ url: '   ', pending_update_count: 0 });

    await expect(api.getWebhookInfo(TOKEN)).resolves.toHaveProperty('url', null);
  });

  /**
   * Telegram omite los campos que no aplican en vez de mandarlos en `null`. Si
   * eso llegara como `undefined` a la pantalla, `pendientes` se dibujaría vacío
   * en lugar de cero — y "no sé" no es lo mismo que "ninguno".
   */
  it('lo que Telegram omite no llega como undefined', async () => {
    telegramResponde({});

    await expect(api.getWebhookInfo(TOKEN)).resolves.toEqual({
      url: null,
      pendientes: 0,
      ip: null,
      ultimoErrorEn: null,
      ultimoError: null,
    });
  });
});
