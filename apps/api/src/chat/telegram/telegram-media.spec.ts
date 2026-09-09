/**
 * Qué archivo bajar de un mensaje de Telegram (2.4).
 *
 * Sin red y sin base. Lo que se fija acá es la decisión, no la descarga.
 */

import { queBajar, textoDeRechazo } from './telegram-media';

const MAX = 5 * 1024 * 1024;

describe('fotos', () => {
  /**
   * ⚠️ **La regla que más importa.**
   *
   * Telegram manda el array de menor a mayor. Estas fotos suelen ser
   * **comprobantes de transferencia**: agarrar la miniatura daría una imagen
   * donde no se lee el monto, que es exactamente el dato por el que la mandaron.
   */
  it('elige la más grande que entre en el límite', () => {
    const d = queBajar(
      {
        photo: [
          { file_id: 'chica', file_size: 1_000 },
          { file_id: 'media', file_size: 200_000 },
          { file_id: 'grande', file_size: 900_000 },
        ],
      },
      MAX,
    );

    expect(d).toEqual({
      tipo: 'bajar',
      fileId: 'grande',
      mime: 'image/jpeg',
      nombre: 'foto.jpg',
      bytes: 900_000,
    });
  });

  it('descarta las que no entran y se queda con la mayor que sí', () => {
    const d = queBajar(
      {
        photo: [
          { file_id: 'chica', file_size: 1_000 },
          { file_id: 'justo', file_size: MAX - 1 },
          { file_id: 'enorme', file_size: MAX * 3 },
        ],
      },
      MAX,
    );

    expect(d).toMatchObject({ tipo: 'bajar', fileId: 'justo' });
  });

  it('si NINGUNA entra, lo dice en vez de callarse', () => {
    const d = queBajar(
      { photo: [{ file_id: 'enorme', file_size: MAX * 10 }] },
      MAX,
    );

    expect(d).toEqual({ tipo: 'rechazar', motivo: 'mandó una foto demasiado grande' });
  });

  /**
   * Sin `file_size` no se puede decidir por tamaño. Se baja igual y lo corta la
   * validación: mejor gastar una descarga que descartar un comprobante bueno.
   */
  it('sin tamaño declarado, la baja igual', () => {
    const d = queBajar({ photo: [{ file_id: 'sin-tamaño' }] }, MAX);
    expect(d).toMatchObject({ tipo: 'bajar', fileId: 'sin-tamaño' });
  });
});

describe('documentos', () => {
  it('baja un PDF con su nombre y su tipo', () => {
    const d = queBajar(
      {
        document: {
          file_id: 'doc1',
          file_size: 50_000,
          mime_type: 'application/pdf',
          file_name: 'comprobante.pdf',
        },
      },
      MAX,
    );

    expect(d).toEqual({
      tipo: 'bajar',
      fileId: 'doc1',
      mime: 'application/pdf',
      nombre: 'comprobante.pdf',
      bytes: 50_000,
    });
  });

  /**
   * El nombre viene del teléfono de otra persona: puede traer rutas o basura.
   */
  it('sanea el nombre del archivo', () => {
    const d = queBajar(
      {
        document: {
          file_id: 'x',
          file_size: 10,
          file_name: '../../etc/passwd',
        },
      },
      MAX,
    );

    expect(d).toMatchObject({ nombre: 'passwd' });
  });

  it('acorta un nombre larguísimo', () => {
    const d = queBajar(
      { document: { file_id: 'x', file_size: 10, file_name: `${'a'.repeat(400)}.pdf` } },
      MAX,
    );

    expect((d as { nombre: string }).nombre.length).toBeLessThanOrEqual(120);
  });

  it('uno demasiado grande se rechaza con motivo', () => {
    const d = queBajar(
      { document: { file_id: 'x', file_size: MAX * 2 } },
      MAX,
    );

    expect(d).toEqual({
      tipo: 'rechazar',
      motivo: 'mandó un archivo demasiado grande',
    });
  });
});

describe('lo que no aceptamos se NOMBRA, no se traga', () => {
  /**
   * Tragárselos en silencio dejaría al operador viendo un mensaje vacío y
   * pensando que se rompió algo. Decir qué llegó le permite pedirle a la
   * persona que lo escriba.
   */
  it.each([
    ['una nota de voz', { voice: { file_id: 'v' } }, 'mandó una nota de voz'],
    ['un audio', { audio: { file_id: 'a' } }, 'mandó un audio'],
    ['un video', { video: { file_id: 'v' } }, 'mandó un video'],
    ['un video redondo', { video_note: { file_id: 'v' } }, 'mandó un video'],
    ['un GIF', { animation: { file_id: 'g' } }, 'mandó un GIF'],
    ['una figurita', { sticker: { file_id: 's' } }, 'mandó una figurita'],
  ])('%s', (_caso, msg, motivo) => {
    expect(queBajar(msg, MAX)).toEqual({ tipo: 'rechazar', motivo });
  });
});

describe('sin adjuntos', () => {
  it('un mensaje de texto no trae nada que bajar', () => {
    expect(queBajar({}, MAX)).toEqual({ tipo: 'nada' });
  });
});

describe('precedencia', () => {
  /**
   * Un mensaje puede traer más de una cosa. La foto gana: es lo que la persona
   * quiso mostrar, y es el caso del comprobante.
   */
  it('la foto le gana al documento', () => {
    const d = queBajar(
      {
        photo: [{ file_id: 'foto', file_size: 100 }],
        document: { file_id: 'doc', file_size: 100 },
      },
      MAX,
    );
    expect(d).toMatchObject({ fileId: 'foto' });
  });
});

describe('textoDeRechazo', () => {
  it('conserva lo que la persona escribió y agrega el aviso', () => {
    expect(textoDeRechazo('mandó una nota de voz', 'hola, escuchá esto')).toBe(
      'hola, escuchá esto\n\n⚠️ Mandó una nota de voz, y por ahora no se puede ver acá.',
    );
  });

  it('sin texto, deja sólo el aviso', () => {
    expect(textoDeRechazo('mandó un video', '')).toBe(
      '⚠️ Mandó un video, y por ahora no se puede ver acá.',
    );
  });
});
