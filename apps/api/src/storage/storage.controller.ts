/**
 * StorageController — Sprint 51.6.
 *
 * Sirve los archivos guardados en disco local via
 * `GET /storage/files/<key>`. Solo aplica cuando STORAGE_DRIVER=local
 * (en R2 las URLs son del bucket directo / CDN — no pasan por el API).
 *
 * No tiene auth — los keys son UUIDs no-enumerables, y el bucket
 * local es para dev. En prod usar R2 con bucket privado + signed URLs.
 */

import {
  All,
  BadRequestException,
  Controller,
  Logger,
  NotFoundException,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream, promises as fs } from 'fs';
import { normalize, resolve, sep } from 'path';

@Controller()
export class StorageController {
  private readonly logger = new Logger(StorageController.name);
  private readonly root: string;
  private readonly urlPrefix = '/storage/files/';

  constructor() {
    this.root = resolve(process.env.STORAGE_LOCAL_ROOT ?? './storage');
  }

  /**
   * GET /storage/files/<key>...
   *
   * Express captura todo lo que viene después de `/storage/files/` en
   * el URL completo. Lo extraemos manualmente desde `req.url` para
   * evitar problemas con la sintaxis de wildcards en Nest 11.
   */
  @All('storage/files/*splat')
  async serve(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new BadRequestException('Solo GET/HEAD permitidos.');
    }
    // Extraer el path completo después del prefix — tolerante a la
    // forma en que Nest 11 mappea los wildcards.
    const url = req.url || req.originalUrl || '';
    const idx = url.indexOf(this.urlPrefix);
    if (idx === -1) {
      throw new BadRequestException('Path requerido.');
    }
    const fullPath = decodeURIComponent(
      url.slice(idx + this.urlPrefix.length).split('?')[0] ?? '',
    );
    if (!fullPath) {
      throw new BadRequestException('Path requerido.');
    }
    // Bloquear path-traversal antes de resolver.
    if (fullPath.includes('..')) {
      throw new BadRequestException('Path inválido.');
    }
    const absPath = resolve(this.root, fullPath);
    const normalizedRoot = normalize(this.root) + sep;
    if (!absPath.startsWith(normalizedRoot.replace(/[\\/]+$/, sep))) {
      throw new BadRequestException('Path inválido (traversal).');
    }
    try {
      await fs.access(absPath);
    } catch {
      throw new NotFoundException('Archivo no encontrado.');
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const mime = guessMime(absPath);
    if (mime) res.setHeader('Content-Type', mime);

    const { size } = await fs.stat(absPath);

    // ── Rangos: lo que hace que un audio se pueda reproducir ────────────────
    //
    // Un `<audio>` **no baja el archivo entero y lo reproduce**: pide rangos, y
    // necesita saber el largo para calcular la duración. Sin `Content-Length` ni
    // `Accept-Ranges`, el reproductor se dibuja, se queda en `0:00 / 0:00` y no
    // arranca — sin ningún error, ni en la pantalla ni en la consola.
    //
    // Pasó exactamente eso el 2026-09-10 con la primera nota de voz que llegó
    // por Telegram. Las imágenes nunca lo necesitaron: un `<img>` se conforma
    // con un 200 y el cuerpo entero.
    res.setHeader('Accept-Ranges', 'bytes');

    const rango = leerRango(req.headers.range, size);
    if (rango === 'invalido') {
      // Pedido fuera del archivo: lo que corresponde es 416 con el largo real,
      // para que el cliente pueda corregir en vez de reintentar igual.
      res.setHeader('Content-Range', `bytes */${size}`);
      res.status(416).end();
      return;
    }

    if (rango) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${rango.desde}-${rango.hasta}/${size}`);
      res.setHeader('Content-Length', String(rango.hasta - rango.desde + 1));
    } else {
      res.setHeader('Content-Length', String(size));
    }

    // Un HEAD lleva los mismos headers y ningún cuerpo. El navegador lo usa
    // para preguntar el largo antes de decidir cómo pedir el archivo.
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = rango
      ? createReadStream(absPath, { start: rango.desde, end: rango.hasta })
      : createReadStream(absPath);
    stream.on('error', (err) => {
      this.logger.error(`Error sirviendo ${absPath}: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  }
}

/**
 * El `Range` pedido, acotado al archivo.
 *
 * `null` = no pidió rango (se manda entero). `'invalido'` = pidió algo que no
 * existe en este archivo, y eso es un 416, no un 200 con otra cosa: devolver
 * bytes distintos a los pedidos rompe al cliente de la forma más difícil de
 * depurar.
 *
 * Sólo se soporta **un** rango simple (`bytes=desde-hasta`). Los múltiples
 * (`bytes=0-99,200-299`) existen en la especificación y ningún reproductor los
 * usa; tratarlos como "sin rango" manda el archivo entero, que es correcto
 * aunque no sea óptimo.
 */
function leerRango(
  header: string | undefined,
  size: number,
): { desde: number; hasta: number } | null | 'invalido' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;

  const [, crudoDesde, crudoHasta] = m;
  // `bytes=-500` son los ÚLTIMOS 500 bytes, no los primeros. Leerlo al revés
  // devuelve el pedazo equivocado sin que nada falle.
  if (!crudoDesde) {
    const ultimos = Number(crudoHasta);
    if (!ultimos) return 'invalido';
    return { desde: Math.max(0, size - ultimos), hasta: size - 1 };
  }

  const desde = Number(crudoDesde);
  const hasta = crudoHasta ? Number(crudoHasta) : size - 1;
  if (desde >= size || desde > hasta) return 'invalido';
  return { desde, hasta: Math.min(hasta, size - 1) };
}

/**
 * El `Content-Type` por extensión.
 *
 * ⚠️ **Esta lista tiene que seguir a `CHAT_ATTACHMENT_MIMES`.** Cuando el 3.5
 * sumó audio a los adjuntos, acá no se sumó nada: un `.ogg` devolvía `null`, el
 * archivo salía **sin `Content-Type`**, y el `<audio>` no lo reproducía. Las
 * imágenes no lo notaron porque ya estaban en la lista.
 *
 * Devolver `null` no es inofensivo: sin tipo, el navegador tiene que adivinar, y
 * para media directamente no lo intenta.
 */
function guessMime(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  // Audio (**3.5**). `.opus` va como ogg: es el contenedor que manda WhatsApp y
  // Telegram, y es lo que el navegador sabe leer.
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.amr')) return 'audio/amr';
  return null;
}
