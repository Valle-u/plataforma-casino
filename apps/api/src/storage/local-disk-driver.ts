/**
 * LocalDiskDriver — Sprint 51.6.
 *
 * Driver de storage para development y CI. Guarda los archivos en
 * disco local (`STORAGE_LOCAL_ROOT`, default: `apps/api/storage`) y
 * los sirve via el endpoint estático `GET /storage/files/<key>`.
 *
 * No usar en producción — sin replicación, sin CDN, sin signed URLs.
 * En prod usar `R2Driver` con env `STORAGE_DRIVER=r2`.
 */

import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join, normalize, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import type { StorageDriver, UploadParams, UploadResult } from './storage.types';

@Injectable()
export class LocalDiskDriver implements StorageDriver {
  private readonly logger = new Logger(LocalDiskDriver.name);
  private readonly root: string;
  /**
   * Base URL pública del API. El cliente la usa para acceder a los
   * archivos via `GET /storage/files/<key>`. Configurable via env.
   *
   * ⚠️ **Es SOLO EL ORIGEN**, sin path: el `/storage/files/` lo agrega este
   * driver. Ponerle el path completo da URLs duplicadas
   * (`/storage/files/storage/files/<key>`) que devuelven 404 sin decir por qué.
   */
  private readonly publicBaseUrl: string;

  constructor() {
    this.root = resolve(
      process.env.STORAGE_LOCAL_ROOT ?? './storage',
    );
    const configurada = process.env.STORAGE_PUBLIC_BASE_URL;
    this.publicBaseUrl = (configurada ?? 'http://localhost:3000').replace(
      /\/$/,
      '',
    );

    // ⚠️ El default de localhost es un pie de plomo en cualquier entorno
    // desplegado: las URLs de los adjuntos quedan apuntando a la máquina de
    // **quien mira**, no al servidor. Y falla en silencio dos veces — una
    // imagen no carga, un `<audio>` no suena, y encima el navegador lo bloquea
    // por contenido mixto (`http` adentro de una página `https`) sin que nada
    // aparezca en la pantalla.
    //
    // Pasó de verdad en staging el 2026-09-10, con la primera nota de voz que
    // llegó por Telegram: el archivo se había guardado bien y el reproductor no
    // sonaba. Se tardó más en encontrar que en arreglar.
    if (!configurada && process.env.NODE_ENV !== 'development') {
      this.logger.error(
        'STORAGE_PUBLIC_BASE_URL no está configurada: los adjuntos van a ' +
          'apuntar a http://localhost:3000 y NO van a cargar para nadie. ' +
          'Poner el origen de la API (sin /storage/files).',
      );
    }

    if (configurada?.includes('/storage/files')) {
      this.logger.error(
        `STORAGE_PUBLIC_BASE_URL ("${configurada}") ya trae /storage/files: ` +
          'este driver lo agrega solo, así que las URLs van a salir con el ' +
          'path duplicado y dar 404. Dejar sólo el origen.',
      );
    }
    // Crear el root si no existe (fire-and-forget; si falla, los
    // primeros uploads van a fallar con mensaje claro).
    fs.mkdir(this.root, { recursive: true }).catch((err) => {
      this.logger.error(`No se pudo crear root '${this.root}': ${err.message}`);
    });
  }

  async upload(params: UploadParams): Promise<UploadResult> {
    const ext = sanitizeExt(params.originalName);
    const id = randomUUID();
    const relativeKey = `tenants/${params.tenantSlug}/${params.keyPrefix}/${id}${ext}`;
    const absPath = this.resolveSafe(relativeKey);
    await fs.mkdir(join(absPath, '..'), { recursive: true });
    await fs.writeFile(absPath, params.buffer);
    return {
      storageKey: relativeKey,
      url: `${this.publicBaseUrl}/storage/files/${relativeKey}`,
      sizeBytes: params.buffer.length,
    };
  }

  getUrl(storageKey: string): Promise<string> {
    // El bucket local es público — la URL es estable.
    return Promise.resolve(
      `${this.publicBaseUrl}/storage/files/${storageKey}`,
    );
  }

  async delete(storageKey: string): Promise<boolean> {
    try {
      const absPath = this.resolveSafe(storageKey);
      await fs.unlink(absPath);
      return true;
    } catch (err: unknown) {
      // ENOENT = ya no existe. Cuenta como borrado: el contrato es "¿ya no
      // está?", no "¿lo borraste vos?".
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
      // Antes esto tiraba. Ahora se reporta: el contrato dice que no tira, y
      // un `false` es más útil que una excepción que el caller iba a tragarse.
      this.logger.error(
        `No se pudo borrar "${storageKey}": ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Resuelve `relativeKey` contra `root` y valida que el path final
   * NO escape del root (defensa contra path-traversal: `../../etc/passwd`).
   */
  private resolveSafe(relativeKey: string): string {
    const absPath = resolve(this.root, relativeKey);
    const normalizedRoot = normalize(this.root) + sep;
    if (!absPath.startsWith(normalizedRoot.replace(/[\\/]+$/, sep))) {
      throw new Error(
        `Path traversal detectado: key '${relativeKey}' resuelve fuera del root.`,
      );
    }
    return absPath;
  }
}

/**
 * Sanea la extensión del nombre original. Mantiene solo `[a-z0-9]`
 * para evitar paths raros / casos como `archivo.tar.gz.exe`.
 */
function sanitizeExt(originalName: string): string {
  const raw = extname(originalName).toLowerCase();
  if (raw.length === 0 || raw.length > 8) return '';
  if (!/^\.[a-z0-9]+$/.test(raw)) return '';
  return raw;
}
