/**
 * Partir una entrega de Meta por número (**3.2**). Sin red y sin base.
 *
 * Lo que se fija acá **no es parsear JSON**: es que el payload de un casino no
 * termine guardado en la base de otro. Eso es **P4**, y el modo de falla no es
 * un error en pantalla — es una filtración en reposo que nadie ve.
 */

import { trozosPorNumero } from './payload-de-meta';

/** Un cambio como el que manda Meta, con un mensaje de texto. */
function cambio(phoneNumberId: string, wamid: string) {
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
          text: { body: 'hola' },
        },
      ],
    },
    field: 'messages',
  };
}

describe('una entrega normal', () => {
  it('un mensaje de un número da un trozo', () => {
    const trozos = trozosPorNumero({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1', changes: [cambio('num-1', 'wamid.AAA')] }],
    });

    expect(trozos).toHaveLength(1);
    expect(trozos[0]).toMatchObject({
      phoneNumberId: 'num-1',
      wabaId: 'waba-1',
      primerMensajeId: 'wamid.AAA',
    });
  });

  /**
   * ⚠️ **El test que sostiene P4.**
   *
   * Meta puede mandar en una sola entrega mensajes de varios números, y por D23
   * esos números pueden ser de **casinos distintos**. Cada trozo tiene que salir
   * recortado a lo suyo: si el sobre de `num-1` trajera adentro el `change` de
   * `num-2`, el texto que le escribieron a un casino quedaría guardado en la
   * base de otro.
   */
  it('dos números en la misma entrega salen separados y sin verse entre sí', () => {
    const trozos = trozosPorNumero({
      object: 'whatsapp_business_account',
      entry: [
        { id: 'waba-litoral', changes: [cambio('num-litoral', 'wamid.LIT')] },
        { id: 'waba-central', changes: [cambio('num-central', 'wamid.CEN')] },
      ],
    });

    expect(trozos.map((t) => t.phoneNumberId)).toEqual(['num-litoral', 'num-central']);

    // Cada sobre lleva UNA entry con UN change, y sólo el suyo.
    for (const t of trozos) {
      const sobre = t.payload as { entry: Array<{ changes: unknown[] }> };
      expect(sobre.entry).toHaveLength(1);
      expect(sobre.entry[0]!.changes).toHaveLength(1);
    }

    const deLitoral = JSON.stringify(trozos[0]!.payload);
    expect(deLitoral).toContain('num-litoral');
    expect(deLitoral).not.toContain('num-central');
    expect(deLitoral).not.toContain('wamid.CEN');
  });

  it('varios changes en una misma entry también se parten', () => {
    const trozos = trozosPorNumero({
      entry: [
        {
          id: 'waba-1',
          changes: [cambio('num-a', 'wamid.A'), cambio('num-b', 'wamid.B')],
        },
      ],
    });

    expect(trozos.map((t) => t.phoneNumberId)).toEqual(['num-a', 'num-b']);
  });
});

describe('lo que no trae mensajes', () => {
  /**
   * Meta manda también acuses de entrega y de lectura. Se guardan igual —son de
   * ese número y sirven para saber si algo llegó— pero **no tienen `wamid` de
   * mensaje entrante**, así que no aportan clave de idempotencia.
   */
  it('un acuse de entrega es un trozo con primerMensajeId null', () => {
    const trozos = trozosPorNumero({
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'num-1' },
                statuses: [{ id: 'wamid.X', status: 'delivered' }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    });

    expect(trozos).toHaveLength(1);
    expect(trozos[0]!.primerMensajeId).toBeNull();
  });
});

/**
 * Todo esto es **texto de afuera**. Un payload con otra forma tiene que dar una
 * lista vacía, no tirar adentro del webhook: una excepción ahí haría que Meta
 * reciba un error y reintente la entrega entera, en loop.
 */
describe('payloads que no tienen la forma esperada', () => {
  it.each([
    ['null', null],
    ['un string', 'hola'],
    ['un array', [1, 2, 3]],
    ['un objeto vacío', {}],
    ['entry que no es array', { entry: 'no' }],
    ['una entry que es null', { entry: [null] }],
    ['changes que no es array', { entry: [{ id: 'w', changes: 'no' }] }],
    ['un change sin value', { entry: [{ id: 'w', changes: [{}] }] }],
    ['un value sin metadata', { entry: [{ id: 'w', changes: [{ value: {} }] }] }],
  ])('%s no rompe y no produce trozos', (_caso, body) => {
    expect(trozosPorNumero(body)).toEqual([]);
  });

  /**
   * ⚠️ Sin `phone_number_id` **no se sabe de quién es**, y sin eso no hay base
   * donde guardarlo. Se descarta: adivinar sería elegir un casino al azar para
   * meterle datos de otro.
   */
  it('un cambio sin phone_number_id se descarta, y no arrastra a los demás', () => {
    const trozos = trozosPorNumero({
      entry: [
        {
          id: 'waba-1',
          changes: [
            { value: { metadata: {}, messages: [{ id: 'wamid.HUERFANO' }] } },
            cambio('num-ok', 'wamid.OK'),
          ],
        },
      ],
    });

    expect(trozos).toHaveLength(1);
    expect(trozos[0]!.phoneNumberId).toBe('num-ok');
  });

  it('sin id de WABA el trozo sale igual, con wabaId null', () => {
    const trozos = trozosPorNumero({ entry: [{ changes: [cambio('num-1', 'w.1')] }] });
    expect(trozos[0]).toMatchObject({ phoneNumberId: 'num-1', wabaId: null });
  });
});
