/**
 * CloudflareWorkerDriver — Upload proxy via Cloudflare Worker.
 *
 * Instead of using the S3 API directly (which fails from Railway due to
 * TLS issues with Cloudflare R2), this driver forwards the file to a
 * Cloudflare Worker that stores it in R2 via internal binding.
 *
 * Env vars required when STORAGE_DRIVER=cloudflare-worker:
 *   - CF_WORKER_URL        — URL of the deployed Worker (e.g. https://casino-uploader.<account>.workers.dev)
 *   - CF_WORKER_TOKEN      — Bearer token for auth
 *   - R2_PUBLIC_BASE_URL   — Public URL prefix (e.g. https://pub-xxx.r2.dev)
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  StorageDriver,
  UploadParams,
  UploadResult,
} from './storage.types';

@Injectable()
export class CloudflareWorkerDriver implements StorageDriver {
  private readonly logger = new Logger(CloudflareWorkerDriver.name);
  private readonly workerUrl: string;
  private readonly workerToken: string;
  private readonly publicBaseUrl: string;

  constructor() {
    this.workerUrl = requireEnv('CF_WORKER_URL');
    this.workerToken = requireEnv('CF_WORKER_TOKEN');
    this.publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(
      /\/$/,
      '',
    );
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

    const response = await fetch(this.workerUrl, {
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

  async getUrl(storageKey: string, _ttlSeconds?: number): Promise<string> {
    // Bucket is public — direct URL always works.
    return `${this.publicBaseUrl}/${storageKey}`;
  }

  async delete(storageKey: string): Promise<void> {
    // R2 delete via Worker not implemented yet (not needed for uploads).
    this.logger.warn(
      `delete() not implemented for CloudflareWorkerDriver (key: ${storageKey})`,
    );
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
