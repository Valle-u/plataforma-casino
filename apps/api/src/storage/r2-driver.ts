/**
 * R2Driver — Sprint 51.6.
 *
 * Driver de storage contra Cloudflare R2 (S3-compatible). Selección via
 * env `STORAGE_DRIVER=r2`. Vars requeridas:
 *
 *   - R2_ENDPOINT     (ej. https://<accountid>.r2.cloudflarestorage.com)
 *   - R2_ACCESS_KEY_ID
 *   - R2_SECRET_ACCESS_KEY
 *   - R2_BUCKET       (ej. casino-uploads)
 *   - R2_PUBLIC_BASE_URL (opcional — si el bucket es público con dominio
 *                          personalizado, ej. https://files.casino.com)
 *
 * Si `R2_PUBLIC_BASE_URL` está set, la URL es pública (CDN); si no,
 * genera signed URLs con TTL configurable (default 1h).
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import https from 'https';
import type { StorageDriver, UploadParams, UploadResult } from './storage.types';

// Node.js 22+ (OpenSSL 3.x) has TLS handshake failures with Cloudflare R2
// due to stricter cipher suite defaults. Force TLS 1.2 min on the global
// HTTPS agent BEFORE any S3Client connections are made.
https.globalAgent.options.minVersion = 'TLSv1.2';

@Injectable()
export class R2Driver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  /** Si está set, las URLs son públicas (CDN); sino, signed. */
  private readonly publicBaseUrl: string | null;

  constructor() {
    const endpoint = requireEnv('R2_ENDPOINT');
    const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
    this.bucket = requireEnv('R2_BUCKET');
    this.publicBaseUrl = process.env.R2_PUBLIC_BASE_URL
      ? process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, '')
      : null;

    this.client = new S3Client({
      endpoint,
      region: 'auto',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  async upload(params: UploadParams): Promise<UploadResult> {
    const ext = sanitizeExt(params.originalName);
    const id = randomUUID();
    const storageKey = `tenants/${params.tenantSlug}/${params.keyPrefix}/${id}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: params.buffer,
        ContentType: params.mimeType,
        ContentLength: params.buffer.length,
      }),
    );

    const url = await this.getUrl(storageKey);
    return { storageKey, url, sizeBytes: params.buffer.length };
  }

  async getUrl(storageKey: string, ttlSeconds = 3600): Promise<string> {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${storageKey}`;
    }
    // Bucket privado → signed URL con TTL.
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
      { expiresIn: ttlSeconds },
    );
  }

  async delete(storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Variable de entorno ${name} requerida cuando STORAGE_DRIVER=r2.`,
    );
  }
  return v;
}

function sanitizeExt(originalName: string): string {
  const raw = extname(originalName).toLowerCase();
  if (raw.length === 0 || raw.length > 8) return '';
  if (!/^\.[a-z0-9]+$/.test(raw)) return '';
  return raw;
}
