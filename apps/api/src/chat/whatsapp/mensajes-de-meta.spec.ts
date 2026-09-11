/**
 * Leer los mensajes de un `change` de Meta (**3.2**). Sin red y sin base.
 *
 * Lo que se fija acá no es parsear JSON: es **que no se pierda lo que alguien
 * escribió**. Un caption que se cae, un nombre que no se cruza o un tipo que no
 * se nombra terminan todos en lo mismo — el operador ve un mensaje vacío y
 * piensa que se rompió algo.
 */

import { mensajesDelCambio, textoConAdjunto } from './mensajes-de-meta';

/** Un `change` como el que manda Meta, con los mensajes que se le pidan. */
function cambio(mensajes: unknown[], contactos?: unknown[]) {
  return {
    value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '5493415551234', phone_number_id: 'num-1' },
      ...(contactos ? { contacts: contactos } : {}),
      messages: mensajes,
    },
    field: 'messages',
  };
}

const TEXTO = {
  from: '5493415559999',
  id: 'wamid.AAA',
  timestamp: '1789300000',
  type: 'text',
  text: { body: 'hola, no puedo entrar' },
};

describe('un mensaje de texto', () => {
  it('trae el id, el teléfono y el texto', () => {
    const [m] = mensajesDelCambio(cambio([TEXTO]));

    expect(m).toEqual({
      id: 'wamid.AAA',
      telefono: '5493415559999',
      nombre: null,
      texto: 'hola, no puedo entrar',
      adjunto: null,
    });
  });

  /**
   * El nombre del perfil viene **aparte** de los mensajes, en `contacts[]`, y se
   * cruza por `wa_id`. Sin ese cruce el contacto nace sin nombre aunque Meta lo
   * haya mandado.
   */
  it('cruza el nombre del perfil por wa_id', () => {
    const [m] = mensajesDelCambio(
      cambio([TEXTO], [{ wa_id: '5493415559999', profile: { name: 'Juan Pérez' } }]),
    );

    expect(m!.nombre).toBe('Juan Pérez');
  });

  it('un contacto de otro número no le presta su nombre', () => {
    const [m] = mensajesDelCambio(
      cambio([TEXTO], [{ wa_id: '5490000000000', profile: { name: 'Otro' } }]),
    );

    expect(m!.nombre).toBeNull();
  });

  it('varios mensajes en el mismo cambio salen todos', () => {
    const ms = mensajesDelCambio(
      cambio([TEXTO, { ...TEXTO, id: 'wamid.BBB', text: { body: 'segundo' } }]),
    );

    expect(ms.map((m) => m.id)).toEqual(['wamid.AAA', 'wamid.BBB']);
  });
});

describe('lo que no es texto se NOMBRA', () => {
  /**
   * Nada de esto se puede bajar todavía —hace falta el token del WABA contra la
   * API de Meta, que no existe hasta que la cuenta salga del trámite— pero
   * **tragárselo sería peor**: el operador vería un mensaje en blanco.
   */
  it.each([
    ['image', 'una foto'],
    ['audio', 'un audio'],
    ['voice', 'una nota de voz'],
    ['video', 'un video'],
    ['document', 'un archivo'],
    ['sticker', 'una figurita'],
    ['location', 'una ubicación'],
  ])('%s → %s', (tipo, comoSeLlama) => {
    const [m] = mensajesDelCambio(
      cambio([{ ...TEXTO, type: tipo, text: undefined }]),
    );

    expect(m!.adjunto).toEqual({ tipo, comoSeLlama });
  });

  it('un tipo que no conocemos igual se nombra', () => {
    const [m] = mensajesDelCambio(
      cambio([{ ...TEXTO, type: 'algo_nuevo_de_meta', text: undefined }]),
    );

    expect(m!.adjunto?.comoSeLlama).toBe('algo que no sabemos leer');
  });

  /**
   * ⚠️ **El caption es texto del mensaje, no del adjunto.** Si se perdiera, el
   * operador vería "mandó una foto" sin lo que la persona escribió al lado — que
   * suele ser lo que explica la foto.
   */
  it('el caption de una foto se conserva', () => {
    const [m] = mensajesDelCambio(
      cambio([
        {
          ...TEXTO,
          type: 'image',
          text: undefined,
          image: { id: 'media-1', caption: 'te mando el comprobante' },
        },
      ]),
    );

    expect(m!.texto).toBe('te mando el comprobante');
    expect(m!.adjunto?.tipo).toBe('image');
  });

  it('el texto que ve el operador junta lo escrito y el aviso', () => {
    const [m] = mensajesDelCambio(
      cambio([
        { ...TEXTO, type: 'image', text: undefined, image: { caption: 'mirá' } },
      ]),
    );

    const salida = textoConAdjunto(m!);
    expect(salida).toContain('mirá');
    expect(salida).toContain('una foto');
    expect(salida).toContain('no se puede ver acá');
  });

  it('sin caption, el aviso va solo', () => {
    const [m] = mensajesDelCambio(
      cambio([{ ...TEXTO, type: 'voice', text: undefined }]),
    );

    expect(textoConAdjunto(m!)).toBe(
      '⚠️ Mandó una nota de voz, y por ahora no se puede ver acá.',
    );
  });

  it('un texto normal pasa tal cual, sin aviso', () => {
    const [m] = mensajesDelCambio(cambio([TEXTO]));
    expect(textoConAdjunto(m!)).toBe('hola, no puedo entrar');
  });
});

describe('lo que NO es un mensaje', () => {
  /**
   * Los acuses de entrega vienen en el mismo sobre y **no son mensajes de
   * nadie**: no tienen que crear conversación ni contacto.
   */
  it('un acuse de entrega no produce mensajes', () => {
    const soloStatuses = {
      value: {
        metadata: { phone_number_id: 'num-1' },
        statuses: [{ id: 'wamid.X', status: 'delivered', recipient_id: '549341' }],
      },
    };

    expect(mensajesDelCambio(soloStatuses)).toEqual([]);
  });

  /**
   * Sin `wamid` no hay clave de idempotencia y sin `from` no se sabe de quién
   * es. Cualquiera de las dos faltando deja un mensaje a medias, así que se
   * descarta — pero **sin arrastrar a los que sí están bien**.
   */
  it('un mensaje sin id o sin from se descarta, y no arrastra a los demás', () => {
    const ms = mensajesDelCambio(
      cambio([
        { ...TEXTO, id: undefined },
        { ...TEXTO, from: undefined, id: 'wamid.SINFROM' },
        TEXTO,
      ]),
    );

    expect(ms).toHaveLength(1);
    expect(ms[0]!.id).toBe('wamid.AAA');
  });

  it.each([
    ['null', null],
    ['un string', 'hola'],
    ['un array', [1, 2]],
    ['un objeto vacío', {}],
    ['un value sin messages', { value: { metadata: {} } }],
    ['messages que no es array', { value: { messages: 'no' } }],
    ['un mensaje que es null', { value: { messages: [null] } }],
  ])('%s no rompe y no produce mensajes', (_caso, entrada) => {
    expect(mensajesDelCambio(entrada)).toEqual([]);
  });
});
