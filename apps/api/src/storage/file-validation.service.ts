/**
 * FileValidationService — "super filtro" de archivos subidos (comprobantes,
 * assets del panel). Defensa en capas para asegurar que lo que se guarda sea
 * realmente una imagen/PDF limpio y no malware disfrazado.
 *
 * NO existe el "100% garantizado" en seguridad (siempre puede haber malware
 * nuevo). Lo que sí hacemos es reducir el riesgo a lo mínimo práctico:
 *
 *   1. Tamaño     — límite duro (anti-DoS / archivos gigantes).
 *   2. Tipo REAL  — se detecta por los bytes mágicos del contenido, NO por la
 *                   etiqueta (Content-Type) que manda el cliente, que es
 *                   trivial de falsificar.
 *   3. Lista blanca — solo JPEG / PNG / WebP (imágenes) y PDF. Nada de SVG
 *                   (lleva scripts), HTML, ejecutables, etc.
 *   4. Redibujado — 🔑 las imágenes se RE-ENCODEAN desde los píxeles con sharp:
 *                   se descarta metadata, EXIF y cualquier payload embebido
 *                   (polyglots, scripts escondidos). Guardamos la imagen NUEVA,
 *                   no los bytes del usuario. Si no se puede decodificar, no era
 *                   una imagen real → se rechaza.
 *   5. Anti-bomba — límite de píxeles/dimensiones (imágenes que al descomprimir
 *                   explotan la RAM).
 *   6. PDF saneado — se rechazan los PDF con contenido ACTIVO (JavaScript,
 *                   archivos embebidos, acciones de lanzamiento). Un comprobante
 *                   no necesita nada de eso.
 *
 * Ampliación futura (anotada): escaneo antivirus real (ClamAV) — más fácil de
 * sumar en el VPS. Para PDF, la opción de máxima seguridad es rasterizarlo a
 * imagen (convertirlo), que neutraliza TODO el contenido activo.
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

export type AllowedKind = 'image' | 'pdf';

export interface ValidationResult {
  /** Buffer LIMPIO a guardar. Imágenes: re-encodeadas. PDF: original validado. */
  buffer: Buffer;
  /** MIME real normalizado (no el del cliente). */
  mimeType: string;
  /** Extensión normalizada con punto (ej. '.jpg'). */
  extension: string;
  /** Tipo detectado. */
  kind: AllowedKind;
}

export interface ValidateOptions {
  /** Tipos permitidos por el caller. Ej. ['image'] hero; ['image','pdf'] comprobantes. */
  allow: readonly AllowedKind[];
  /** Tamaño máximo en bytes. */
  maxBytes: number;
}

// Límites de sanidad del redibujado (anti "imagen-bomba").
const MAX_IMAGE_PIXELS = 40_000_000; // 40 MP de entrada
const MAX_IMAGE_DIMENSION = 12_000; // px por lado

// Tokens de PDF que indican contenido ACTIVO/peligroso. Un comprobante no los
// necesita, así que su presencia = rechazo.
const PDF_DANGEROUS_TOKENS = [
  '/JavaScript',
  '/JS',
  '/Launch',
  '/EmbeddedFile',
  '/OpenAction',
  '/AA',
  '/RichMedia',
  '/XFA',
  '/GoToR',
  '/SubmitForm',
  '/ImportData',
];

@Injectable()
export class FileValidationService {
  private readonly logger = new Logger(FileValidationService.name);

  async validate(
    buffer: Buffer,
    opts: ValidateOptions,
  ): Promise<ValidationResult> {
    // 1. Tamaño (defensa en profundidad; multer ya limita el stream).
    if (!buffer || buffer.length === 0) {
      throw this.reject('El archivo está vacío.', 'FILE_EMPTY');
    }
    if (buffer.length > opts.maxBytes) {
      throw this.reject(
        `El archivo excede el límite de ${Math.round(opts.maxBytes / (1024 * 1024))} MB.`,
        'FILE_TOO_LARGE',
      );
    }

    // 2. Tipo REAL por bytes mágicos (no la etiqueta del cliente).
    const detected = detectRealType(buffer);
    if (!detected) {
      throw this.reject(
        'No pudimos reconocer el tipo real del archivo. Subí una imagen (JPG/PNG/WebP) o un PDF válido.',
        'FILE_TYPE_UNKNOWN',
      );
    }

    // 3. ¿El caller permite este tipo?
    if (!opts.allow.includes(detected.kind)) {
      throw this.reject(
        `Tipo de archivo no permitido acá (${detected.mimeType}).`,
        'FILE_TYPE_NOT_ALLOWED',
      );
    }

    return detected.kind === 'image'
      ? this.sanitizeImage(buffer)
      : this.sanitizePdf(buffer);
  }

  /** Redibuja la imagen desde los píxeles → descarta cualquier payload embebido. */
  private async sanitizeImage(buffer: Buffer): Promise<ValidationResult> {
    const img = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS });
    const meta = await img.metadata().catch(() => null);
    if (!meta) {
      throw this.reject(
        'El archivo dice ser una imagen pero no se pudo decodificar (corrupto o malicioso).',
        'IMAGE_DECODE_FAILED',
      );
    }
    if (!meta.width || !meta.height) {
      throw this.reject('Imagen inválida (sin dimensiones).', 'IMAGE_INVALID');
    }
    if (meta.width > MAX_IMAGE_DIMENSION || meta.height > MAX_IMAGE_DIMENSION) {
      throw this.reject(
        `Imagen demasiado grande (${meta.width}×${meta.height}). Máx ${MAX_IMAGE_DIMENSION}px por lado.`,
        'IMAGE_TOO_LARGE',
      );
    }

    // Formato de salida según el de entrada (los 3 que aceptamos). `.rotate()`
    // aplica la orientación EXIF y luego sharp descarta toda la metadata al
    // re-encodear (no llamamos a withMetadata()).
    const outFormat: 'jpeg' | 'webp' | 'png' | 'avif' =
      meta.format === 'jpeg'
        ? 'jpeg'
        : meta.format === 'webp'
          ? 'webp'
          : meta.format === 'heif'
            ? 'avif'
            : 'png';

    let clean: Buffer;
    try {
      const pipeline = img.rotate();
      clean =
        outFormat === 'jpeg'
          ? await pipeline.jpeg({ quality: 90 }).toBuffer()
          : outFormat === 'webp'
            ? await pipeline.webp({ quality: 90 }).toBuffer()
            : outFormat === 'avif'
              ? await pipeline.avif({ quality: 70 }).toBuffer()
              : await pipeline.png({ compressionLevel: 9 }).toBuffer();
    } catch {
      throw this.reject('No se pudo procesar la imagen.', 'IMAGE_REENCODE_FAILED');
    }

    const map = {
      jpeg: { mime: 'image/jpeg', ext: '.jpg' },
      webp: { mime: 'image/webp', ext: '.webp' },
      png: { mime: 'image/png', ext: '.png' },
      avif: { mime: 'image/avif', ext: '.avif' },
    } as const;
    const m = map[outFormat];
    return { buffer: clean, mimeType: m.mime, extension: m.ext, kind: 'image' };
  }

  /** Valida el PDF y rechaza contenido activo (JS / embebidos / acciones). */
  private sanitizePdf(buffer: Buffer): ValidationResult {
    // Normalizamos los nombres hex-encoded (#XX) para que no evadan el scan
    // (ej. `/J#61vaScript` → `/JavaScript`).
    const text = decodePdfHexNames(buffer.toString('latin1'));
    for (const token of PDF_DANGEROUS_TOKENS) {
      if (text.includes(token)) {
        this.logger.warn(`PDF rechazado por contenido activo (${token}).`);
        throw this.reject(
          'El PDF contiene contenido activo (scripts, archivos embebidos o acciones) y no se permite por seguridad. Subí una captura o foto del comprobante.',
          'PDF_ACTIVE_CONTENT',
        );
      }
    }
    return {
      buffer,
      mimeType: 'application/pdf',
      extension: '.pdf',
      kind: 'pdf',
    };
  }

  private reject(message: string, error: string): BadRequestException {
    return new BadRequestException({ message, error });
  }
}

/**
 * Detecta el tipo REAL por firma de bytes. Solo los formatos que aceptamos.
 * Devuelve null para cualquier otra cosa (que se rechaza).
 */
export function detectRealType(
  b: Buffer,
): { kind: AllowedKind; mimeType: string } | null {
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { kind: 'image', mimeType: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return { kind: 'image', mimeType: 'image/png' };
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { kind: 'image', mimeType: 'image/webp' };
  }
  // AVIF: ISOBMFF con box "ftyp" y marca "avif"/"avis" en el header.
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') {
    const brands = b.toString('ascii', 8, Math.min(b.length, 32));
    if (brands.includes('avif') || brands.includes('avis')) {
      return { kind: 'image', mimeType: 'image/avif' };
    }
  }
  // PDF: "%PDF-"
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-') {
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }
  return null;
}

/** Decodifica secuencias #XX de los nombres PDF (evasión del scan de tokens). */
function decodePdfHexNames(s: string): string {
  return s.replace(/#([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}
