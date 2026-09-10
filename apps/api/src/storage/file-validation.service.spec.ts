/**
 * Unit tests del "super filtro" de archivos (FileValidationService).
 * Prueba que RECHAZA lo malo y ACEPTA/limpia lo bueno.
 */

import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { FileValidationService, detectRealType } from './file-validation.service';

/** Corre la validación y devuelve el `error` code si rechaza (o un centinela). */
async function rejectCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BadRequestException) {
      const r = e.getResponse();
      if (typeof r === 'object' && r !== null && 'error' in r) {
        return String((r as { error: unknown }).error);
      }
    }
    return 'NON_BADREQUEST';
  }
  return 'NO_THROW';
}

function realPng(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

function realJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg()
    .toBuffer();
}

describe('FileValidationService', () => {
  const svc = new FileValidationService();
  const IMG = { allow: ['image'] as const, maxBytes: 1_000_000 };
  const IMG_PDF = { allow: ['image', 'pdf'] as const, maxBytes: 1_000_000 };

  it('rechaza buffer vacío', async () => {
    expect(await rejectCode(svc.validate(Buffer.alloc(0), IMG))).toBe('FILE_EMPTY');
  });

  it('rechaza archivo que excede el límite', async () => {
    const png = await realPng();
    expect(await rejectCode(svc.validate(png, { allow: ['image'], maxBytes: 10 }))).toBe(
      'FILE_TOO_LARGE',
    );
  });

  it('rechaza tipo desconocido (texto plano)', async () => {
    expect(await rejectCode(svc.validate(Buffer.from('hola mundo'), IMG_PDF))).toBe(
      'FILE_TYPE_UNKNOWN',
    );
  });

  it('rechaza SVG (no está en la lista blanca — puede llevar scripts)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(await rejectCode(svc.validate(svg, IMG_PDF))).toBe('FILE_TYPE_UNKNOWN');
  });

  it('rechaza un ejecutable disfrazado (magic bytes MZ)', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
    expect(await rejectCode(svc.validate(exe, IMG_PDF))).toBe('FILE_TYPE_UNKNOWN');
  });

  it('acepta y REDIBUJA un PNG real', async () => {
    const png = await realPng();
    const res = await svc.validate(png, IMG);
    expect(res.kind).toBe('image');
    expect(res.mimeType).toBe('image/png');
    expect(res.extension).toBe('.png');
    // El resultado es una imagen válida re-decodificable.
    const meta = await sharp(res.buffer).metadata();
    expect(meta.width).toBe(8);
    expect(meta.height).toBe(8);
  });

  it('acepta un JPEG real', async () => {
    const jpg = await realJpeg();
    const res = await svc.validate(jpg, IMG);
    expect(res.mimeType).toBe('image/jpeg');
    expect(res.extension).toBe('.jpg');
  });

  it('rechaza un archivo que MIENTE ser PNG (magic bytes ok, contenido basura)', async () => {
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('no soy una imagen de verdad, soy basura'),
    ]);
    expect(await rejectCode(svc.validate(fake, IMG))).toBe('IMAGE_DECODE_FAILED');
  });

  it('rechaza PDF cuando el caller solo permite imágenes', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\n%%EOF');
    expect(await rejectCode(svc.validate(pdf, IMG))).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('acepta un PDF limpio', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<<>>\n%%EOF');
    const res = await svc.validate(pdf, IMG_PDF);
    expect(res.kind).toBe('pdf');
    expect(res.mimeType).toBe('application/pdf');
    expect(res.extension).toBe('.pdf');
  });

  it('rechaza PDF con JavaScript / OpenAction', async () => {
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<< /OpenAction << /S /JavaScript /JS (app.alert(1);) >> >>endobj\n%%EOF',
    );
    expect(await rejectCode(svc.validate(pdf, IMG_PDF))).toBe('PDF_ACTIVE_CONTENT');
  });

  it('rechaza PDF con archivo embebido (/EmbeddedFile)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<< /Type /EmbeddedFile >>endobj\n%%EOF');
    expect(await rejectCode(svc.validate(pdf, IMG_PDF))).toBe('PDF_ACTIVE_CONTENT');
  });

  it('rechaza PDF con nombre hex-encodeado que intenta evadir (/J#61vaScript)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<< /J#61vaScript (x) >>endobj\n%%EOF');
    expect(await rejectCode(svc.validate(pdf, IMG_PDF))).toBe('PDF_ACTIVE_CONTENT');
  });

  describe('detectRealType', () => {
    it('reconoce PNG/JPEG por bytes mágicos, no por extensión', async () => {
      expect(detectRealType(await realPng())?.mimeType).toBe('image/png');
      expect(detectRealType(await realJpeg())?.mimeType).toBe('image/jpeg');
      expect(detectRealType(Buffer.from('%PDF-1.4'))?.mimeType).toBe('application/pdf');
      expect(detectRealType(Buffer.from('random'))).toBeNull();
    });
  });

  /**
   * Audio (**3.5**): el dueño decidió **audio sí, video no**.
   *
   * Lo que se prueba acá no es que reconozca formatos: es que **la mitad "video
   * no" sea cierta en el código**. OGG y MP4 son contenedores que llevan las dos
   * cosas, así que mirar sólo la firma dejaría entrar justo lo que se cerró — y
   * la decisión quedaría escrita en los docs y falsa en el producto.
   */
  describe('audio (3.5)', () => {
    const AUDIO = { allow: ['image', 'pdf', 'audio'] as const, maxBytes: 1_000_000 };

    /** Un OGG con la cabecera del códec que se le pida. */
    function ogg(codec: string): Buffer {
      const pagina = Buffer.alloc(28);
      pagina.write('OggS', 0, 'ascii');
      return Buffer.concat([pagina, Buffer.from(codec, 'latin1'), Buffer.alloc(64)]);
    }

    /** Un ISOBMFF con la marca que se le pida (`M4A `, `isom`, `avif`…). */
    function ftyp(marca: string): Buffer {
      const b = Buffer.alloc(32);
      b.write('ftyp', 4, 'ascii');
      b.write(marca, 8, 'ascii');
      return b;
    }

    it('acepta una nota de voz OGG/opus', async () => {
      const res = await svc.validate(ogg('OpusHead'), AUDIO);
      expect(res.kind).toBe('audio');
      expect(res.mimeType).toBe('audio/ogg');
      expect(res.extension).toBe('.ogg');
    });

    it('acepta OGG/vorbis', async () => {
      expect((await svc.validate(ogg('\x01vorbis'), AUDIO)).mimeType).toBe('audio/ogg');
    });

    /**
     * ⚠️ **El test que sostiene "video no".**
     *
     * Un `.ogv` con Theora arranca con los **mismos cuatro bytes** que una nota
     * de voz. Sin mirar el códec, entraría — y entraría por la puerta de audio,
     * que es la que se acaba de abrir.
     */
    it('RECHAZA un OGG con video adentro (Theora)', async () => {
      expect(await rejectCode(svc.validate(ogg('\x80theora'), AUDIO))).toBe(
        'FILE_TYPE_UNKNOWN',
      );
    });

    it('acepta un M4A (memo de voz de iPhone)', async () => {
      const res = await svc.validate(ftyp('M4A '), AUDIO);
      expect(res.kind).toBe('audio');
      expect(res.mimeType).toBe('audio/mp4');
    });

    /**
     * ⚠️ **La otra mitad de "video no".** Un MP4 de video tiene el mismo `ftyp`
     * que un M4A: sólo cambia la marca. Aceptar `isom`/`mp42` traería archivos
     * decenas de veces más pesados por el mismo camino.
     */
    it('RECHAZA un MP4 de video (marca isom)', async () => {
      expect(await rejectCode(svc.validate(ftyp('isom'), AUDIO))).toBe(
        'FILE_TYPE_UNKNOWN',
      );
    });

    it('sigue reconociendo AVIF, que comparte el mismo ftyp', () => {
      expect(detectRealType(ftyp('avif'))?.mimeType).toBe('image/avif');
    });

    it('acepta MP3 con tag ID3 y sin él', () => {
      expect(detectRealType(Buffer.from('ID3\x04\x00\x00'))?.mimeType).toBe('audio/mpeg');
      expect(detectRealType(Buffer.from([0xff, 0xfb, 0x90, 0x00]))?.mimeType).toBe(
        'audio/mpeg',
      );
    });

    it('acepta AMR, que es lo que manda WhatsApp en Android viejo', () => {
      expect(detectRealType(Buffer.from('#!AMR\n'))?.mimeType).toBe('audio/amr');
    });

    /**
     * El audio **no se re-encodea** —eso pediría ffmpeg— así que se guarda tal
     * cual vino. Es el mismo trato que ya tiene el PDF. Que quede fijado: si
     * alguien agrega un procesamiento, este test lo obliga a pensarlo.
     */
    it('guarda los bytes originales, sin tocar', async () => {
      const original = ogg('OpusHead');
      const res = await svc.validate(original, AUDIO);
      expect(res.buffer.equals(original)).toBe(true);
    });

    it('un caller que no permite audio lo rechaza', async () => {
      expect(await rejectCode(svc.validate(ogg('OpusHead'), IMG_PDF))).toBe(
        'FILE_TYPE_NOT_ALLOWED',
      );
    });
  });
});
