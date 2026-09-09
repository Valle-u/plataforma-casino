/**
 * El token del bot: forma, tapado y URLs.
 *
 * Sin red y sin base. Lo que se fija acá es lo que hace que un operador
 * entienda qué hizo mal, y que un token no termine en un log.
 */

import {
  idDelBot,
  linkDelBot,
  pareceTokenDeBot,
  taparToken,
  TokenDeBotInvalidoError,
  urlDelWebhook,
} from './telegram-token';

/** La forma que devuelve BotFather. */
const TOKEN = '7891234567:AAF-xYzAbCdEfGhIjKlMnOpQrStUvWxYz12';

describe('la forma del token', () => {
  it('acepta uno de BotFather', () => {
    expect(pareceTokenDeBot(TOKEN)).toBe(true);
    expect(idDelBot(TOKEN)).toBe('7891234567');
  });

  it('tolera espacios alrededor: pegar de un chat los arrastra', () => {
    expect(pareceTokenDeBot(`  ${TOKEN}\n`)).toBe(true);
    expect(idDelBot(` ${TOKEN} `)).toBe('7891234567');
  });

  /**
   * El error de Telegram para un token mal pegado es `401 Unauthorized`, que se
   * lee como "es de otro" o "lo revocaron". Un operador que pegó el NOMBRE del
   * bot en vez del token se quedaría mirando ese 401 sin entender.
   */
  it.each([
    ['vacío', ''],
    ['el nombre del bot', '@miamihub_bot'],
    ['sin los dos puntos', '7891234567AAFxYzAbCdEfGhIjKlMnOpQrSt'],
    ['sin el id', ':AAF-xYzAbCdEfGhIjKlMnOpQrStUvWxYz12'],
    ['el secreto cortado', '7891234567:AAF-xYz'],
    ['un id que no son dígitos', 'abcdefghij:AAF-xYzAbCdEfGhIjKlMnOpQrStUvWxYz12'],
  ])('rechaza %s', (_caso, valor) => {
    expect(pareceTokenDeBot(valor)).toBe(false);
    expect(() => idDelBot(valor)).toThrow(TokenDeBotInvalidoError);
  });

  it('el mensaje del error dice qué se espera, no "inválido"', () => {
    expect(() => idDelBot('@miamihub_bot')).toThrow(/BotFather/);
    expect(() => idDelBot('@miamihub_bot')).toThrow(/copiado entero/);
  });
});

describe('taparToken', () => {
  /**
   * ⚠️ Es la función que evita que un token entero termine en Axiom el día que
   * alguien agregue un `logger.debug` "para ver qué llega".
   */
  it('deja el id del bot y tapa el secreto', () => {
    const tapado = taparToken(TOKEN);

    expect(tapado).toContain('7891234567');
    expect(tapado).not.toContain('AAF-xYz');
    expect(tapado).not.toContain('UvWxYz12');
  });

  it('lo que no parece un token se tapa entero', () => {
    // Si no matchea la forma, no se sabe qué parte es secreta: se tapa todo.
    expect(taparToken('cualquier cosa')).toBe('***');
    expect(taparToken('')).toBe('***');
  });
});

describe('urlDelWebhook', () => {
  it('arma la ruta con el casino y el canal', () => {
    expect(
      urlDelWebhook('https://api.miamihub.vip', 'miamihub', 'abc-123'),
    ).toBe('https://api.miamihub.vip/api/v1/crm/telegram/webhook/miamihub/abc-123');
  });

  it('no duplica la barra si la base viene con una', () => {
    expect(urlDelWebhook('https://api.miamihub.vip/', 'x', 'y')).toBe(
      'https://api.miamihub.vip/api/v1/crm/telegram/webhook/x/y',
    );
  });

  it('escapa el slug: es un dato de la base, no una constante', () => {
    expect(urlDelWebhook('https://a.b', 'con espacio', 'c')).toContain(
      'con%20espacio',
    );
  });
});

describe('linkDelBot', () => {
  /**
   * No es un adorno: por una restricción de Telegram **un bot sólo puede
   * hablarle a quien le escribió primero**. Sin este link el canal no arranca
   * nunca.
   */
  it('arma el link que el operador le pasa a sus jugadores', () => {
    expect(linkDelBot('miamihub_bot')).toBe('https://t.me/miamihub_bot');
  });

  it('acepta el username con arroba, como lo muestra Telegram', () => {
    expect(linkDelBot('@miamihub_bot')).toBe('https://t.me/miamihub_bot');
  });
});
