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
    let fullPath = decodeURIComponent(
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
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const mime = guessMime(absPath);
    if (mime) res.setHeader('Content-Type', mime);
    const stream = createReadStream(absPath);
    stream.on('error', (err) => {
      this.logger.error(`Error sirviendo ${absPath}: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  }
}

function guessMime(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return null;
}
