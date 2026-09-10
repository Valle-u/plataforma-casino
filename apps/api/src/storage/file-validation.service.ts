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

export type AllowedKind = 'image' | 'pdf' | 'audio';

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

    if (detected.kind === 'image') return this.sanitizeImage(buffer);
    if (detected.kind === 'audio') {
      return sanitizeAudio(buffer, detected.mimeType);
    }
    return this.sanitizePdf(buffer);
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
 * El audio se guarda **tal como vino**, y eso hay que decirlo.
 *
 * ## Lo que este camino NO hace
 *
 * No hay nada equivalente al **redibujado** de las imágenes, que es la defensa
 * más fuerte del filtro: una imagen se re-encodea desde los píxeles y lo que se
 * guarda es un archivo nuevo, sin metadata ni payload embebido. Para audio eso
 * pediría **ffmpeg** —una dependencia binaria pesada— y re-encodear una nota de
 * voz además la degrada.
 *
 * ## Por qué se acepta igual
 *
 * Es el mismo trato que ya tiene el **PDF**, que también se guarda con sus bytes
 * originales después de mirarlos. Y el riesgo es distinto al de un ejecutable:
 * un audio se decodifica en el sandbox del navegador, no se ejecuta. Lo que
 * queda expuesto es una vulnerabilidad del decodificador, que es el mismo riesgo
 * que acepta cualquier app de mensajería.
 *
 * Lo que sí se hace, y es lo que importa acá, es **no confiar en la etiqueta del
 * cliente**: el tipo sale de los bytes mágicos, y de los contenedores se mira el
 * códec de adentro para que no entre video disfrazado (ver `detectRealType`).
 *
 * ⚠️ Si algún día entra ClamAV —anotado arriba como ampliación—, este es el
 * camino que más lo necesita.
 */
function sanitizeAudio(buffer: Buffer, mimeType: string): ValidationResult {
  const ext = {
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/amr': '.amr',
  }[mimeType];

  return {
    buffer,
    mimeType,
    // Un tipo detectado que no esté en el mapa sería un bug de `detectRealType`,
    // no una entrada del usuario. `.bin` antes que romper la subida.
    extension: ext ?? '.bin',
    kind: 'audio',
  };
}

/**
 * Detecta el tipo REAL por firma de bytes. Solo los formatos que aceptamos.
 * Devuelve null para cualquier otra cosa (que se rechaza).
 *
 * ## ⚠️ Con audio no alcanza la firma del archivo
 *
 * El dueño decidió **audio sí, video no**. Pero OGG y MP4 no son formatos: son
 * **contenedores**, y los dos llevan video igual de bien que audio. Un `.ogv` con
 * Theora adentro empieza con los mismos cuatro bytes que una nota de voz, y un
 * `.mp4` de 40 MB empieza con el mismo `ftyp` que un audio de iPhone.
 *
 * O sea que mirar sólo la firma dejaría entrar **exactamente lo que se decidió
 * dejar afuera**, y la decisión quedaría escrita en los docs y falsa en el
 * código. Por eso de los contenedores se mira **qué códec traen adentro**.
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
  // ISOBMFF (box "ftyp"): la misma familia sirve para AVIF, para audio M4A y
  // para video MP4. Los distingue la **marca**, no la firma.
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') {
    const brands = b.toString('ascii', 8, Math.min(b.length, 32));
    if (brands.includes('avif') || brands.includes('avis')) {
      return { kind: 'image', mimeType: 'image/avif' };
    }
    // Sólo `M4A `, que es audio. `isom`, `mp42` y `avc1` son las marcas de un
    // MP4 de **video** — aceptarlas sería dejar entrar video por la puerta que
    // se cerró a propósito, y con un archivo cuarenta veces más pesado.
    if (brands.includes('M4A ')) {
      return { kind: 'audio', mimeType: 'audio/mp4' };
    }
  }
  // PDF: "%PDF-"
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-') {
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }
  // OGG: "OggS". Es el de las notas de voz de WhatsApp y de Telegram — pero
  // también el de los videos Theora, así que hay que mirar el códec.
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS') {
    return codecDelOgg(b);
  }
  // MP3: "ID3" (con tag) o el sync de frame `FF Ex/Fx`.
  if (b.length >= 3 && b.toString('ascii', 0, 3) === 'ID3') {
    return { kind: 'audio', mimeType: 'audio/mpeg' };
  }
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) {
    return { kind: 'audio', mimeType: 'audio/mpeg' };
  }
  // AMR: "#!AMR". Viejo, pero es lo que manda WhatsApp en algunos Android.
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '#!AMR') {
    return { kind: 'audio', mimeType: 'audio/amr' };
  }
  return null;
}

/**
 * Qué códec trae un OGG, mirando la cabecera de identificación.
 *
 * El contenedor OGG no dice qué lleva: lo dice el **primer paquete** de la
 * primera página, que arranca con un nombre reconocible —`OpusHead`,
 * `\x01vorbis`, `\x80theora`—. Vive en los primeros bytes, así que alcanza con
 * mirar el arranque en vez de parsear el archivo entero.
 *
 * Devuelve `null` para lo que no sea audio conocido, incluido **Theora**, que es
 * video adentro del mismo contenedor. Ese es todo el punto de esta función: sin
 * ella, "video no" sería cierto para los `.mp4` y falso para los `.ogv`.
 */
function codecDelOgg(b: Buffer): { kind: AllowedKind; mimeType: string } | null {
  const arranque = b.toString('latin1', 0, Math.min(b.length, 128));
  if (arranque.includes('OpusHead') || arranque.includes('vorbis')) {
    return { kind: 'audio', mimeType: 'audio/ogg' };
  }
  return null;
}

/** Decodifica secuencias #XX de los nombres PDF (evasión del scan de tokens). */
function decodePdfHexNames(s: string): string {
  return s.replace(/#([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}
