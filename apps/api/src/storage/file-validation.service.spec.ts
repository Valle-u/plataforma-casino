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
});
