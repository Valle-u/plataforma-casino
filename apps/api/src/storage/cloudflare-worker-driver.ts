/**
 * CloudflareWorkerDriver — Upload proxy via Cloudflare Worker.
 *
 * Instead of using the S3 API directly (which fails from Railway due to
 * TLS issues with Cloudflare R2), this driver forwards the file to a
 * Cloudflare Worker that stores it in R2 via internal binding.
 *
 * Env vars required when STORAGE_DRIVER=cloudflare-worker:
 *   - CF_WORKER_URL   — URL of the deployed Worker (e.g. https://casino-uploader.<account>.workers.dev)
 *   - CF_WORKER_TOKEN — Bearer token for auth
 *
 * Opcional (y necesario para que los comprobantes dejen de ser públicos):
 *   - CF_WORKER_SIGNING_SECRET — secreto compartido con el Worker. Si está,
 *     las URLs de comprobantes salen firmadas y con vencimiento.
 */

import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  StorageDriver,
  UploadParams,
  UploadResult,
} from './storage.types';

/**
 * Carpetas cuyos archivos NO pueden ser públicos.
 *
 * - `/proofs/` — comprobantes de depósito y de transferencias bancarias:
 *   nombre, CUIT, CBU y monto de personas reales.
 * - `/chat/attachments/` — lo que la gente manda por el chat: fotos del DNI,
 *   capturas de transferencias. Agregado el 2026-09-08; hasta entonces estos
 *   archivos se servían **públicos y con caché de un año**, porque la regla
 *   miraba una sola carpeta y ésta no era. Ver `docs/crm/14-decisiones.md` D12.
 *
 * ⚠️ **Esta lista tiene un gemelo** en `worker/src/index.js`
 * (`CARPETAS_PRIVADAS`). Ésta decide qué se firma; la del Worker decide qué se
 * exige firmado y qué se cachea. **Si divergen, el fallo es silencioso**: una
 * carpeta que acá se firma y allá no es privada sale igual y nadie se entera.
 *
 * No se puede compartir el código —el Worker es un bundle aparte, sin acceso a
 * `apps/api`— así que se duplica a propósito, con este aviso en los dos lados.
 */
const CARPETAS_PRIVADAS = ['/proofs/', '/chat/attachments/'];

/** ¿La key es de un documento privado? */
function esPrivada(storageKey: string): boolean {
  return CARPETAS_PRIVADAS.some((c) => storageKey.includes(c));
}

/** Cuánto vive una URL firmada. Corto: se regenera en cada lectura. */
const TTL_POR_DEFECTO_SEG = 900;

@Injectable()
export class CloudflareWorkerDriver implements StorageDriver {
  private readonly logger = new Logger(CloudflareWorkerDriver.name);
  private readonly workerUrl: string;
  private readonly workerToken: string;
  private readonly signingSecret: string | null;

  constructor() {
    this.workerUrl = requireEnv('CF_WORKER_URL');
    this.workerToken = requireEnv('CF_WORKER_TOKEN');
    // Opcional a propósito: sin secreto el driver se comporta como antes, así
    // que se puede desplegar esto ANTES de configurar el Worker sin romper nada.
    this.signingSecret = process.env.CF_WORKER_SIGNING_SECRET ?? null;
    if (!this.signingSecret) {
      this.logger.warn(
        'CF_WORKER_SIGNING_SECRET no configurado: los comprobantes se sirven ' +
          'con URL pública sin vencimiento.',
      );
    }
  }

  async upload(params: UploadParams): Promise<UploadResult> {
    // Build multipart form body — Worker generates the storage key
    const form = new FormData();
    form.append(
      'file',
      new Blob([params.buffer], { type: params.mimeType }),
      params.originalName,
    );
    form.append('keyPrefix', params.keyPrefix);
    form.append('tenantSlug', params.tenantSlug);

    const response = await fetch(`${this.workerUrl}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.workerToken}`,
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `Worker upload failed (${response.status}): ${body}`,
      );
      throw new Error(
        `Cloudflare Worker upload failed: ${response.status} ${body}`,
      );
    }

    const result = (await response.json()) as {
      url: string;
      storageKey: string;
      sizeBytes: number;
    };

    return {
      storageKey: result.storageKey,
      url: result.url,
      sizeBytes: result.sizeBytes,
    };
  }

  /**
   * URL para mostrar el archivo.
   *
   * Los documentos privados —comprobantes y adjuntos del chat— salen
   * **firmados y con vencimiento**; el resto (logos, hero) sigue siendo una URL
   * pública estable, que es lo que corresponde para la marca del casino.
   *
   * La firma es HMAC-SHA256 sobre `<key>:<exp>`. El Worker la revalida con el
   * mismo secreto antes de servir. Se firma la key **y** el vencimiento juntos:
   * firmar sólo el vencimiento dejaría reusar una firma para cualquier archivo.
   */
  // Sin `async`: firmar es sincrónico. La interfaz pide `Promise<string>`
  // porque otros drivers (R2 presigned) sí hacen I/O.
  getUrl(storageKey: string, ttlSeconds?: number): Promise<string> {
    const base = `${this.workerUrl}/files/${storageKey}`;
    if (!this.signingSecret || !esPrivada(storageKey)) {
      return Promise.resolve(base);
    }
    const exp =
      Math.floor(Date.now() / 1000) + (ttlSeconds ?? TTL_POR_DEFECTO_SEG);
    const sig = createHmac('sha256', this.signingSecret)
      .update(`${storageKey}:${exp}`)
      .digest('hex');
    return Promise.resolve(`${base}?exp=${exp}&sig=${sig}`);
  }

  /**
   * Borra el archivo de R2, vía `DELETE /files/:key` del Worker.
   *
   * Hasta el 2026-09-06 esto **no hacía nada**: sólo escribía un warning. El
   * caller que más importa es el rechazo de un depósito, que da por hecho que
   * el comprobante se borra — así que los comprobantes de depósitos rechazados
   * se acumulaban en R2 para siempre, y públicos.
   *
   * No tira si falla. Es a propósito: el caller ya hizo lo que importaba
   * —rechazar el depósito, con su registro en auditoría— y hacerlo fallar
   * entero porque no se pudo borrar un archivo cambiaría un problema de
   * housekeeping por uno de negocio. Queda en el log como `error` para que se
   * pueda encontrar y limpiar.
   */
  async delete(storageKey: string): Promise<void> {
    try {
      const res = await fetch(`${this.workerUrl}/files/${storageKey}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.workerToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        this.logger.error(
          `No se pudo borrar "${storageKey}" (${res.status}): ${await res.text()}`,
        );
        return;
      }
      this.logger.log(`Borrado de R2: ${storageKey}`);
    } catch (err) {
      this.logger.error(
        `No se pudo borrar "${storageKey}": ${(err as Error).message}`,
      );
    }
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Variable de entorno ${name} requerida cuando STORAGE_DRIVER=cloudflare-worker.`,
    );
  }
  return v;
}
