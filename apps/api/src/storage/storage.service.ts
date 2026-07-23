/**
 * StorageService — Sprint 51.6.
 *
 * Wrapper sobre el StorageDriver activo (local o R2). Expone la misma
 * interfaz que StorageDriver pero es inyectable vía Nest DI. El módulo
 * inyecta el driver correcto según env STORAGE_DRIVER.
 *
 * Usado por DepositsController (upload comprobantes), futuro: bonos
 * banners, avatars, branding, etc.
 */

import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_DRIVER_TOKEN } from './storage.tokens';
import type {
  StorageDriver,
  UploadParams,
  UploadResult,
} from './storage.types';

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_DRIVER_TOKEN) private readonly driver: StorageDriver,
  ) {}

  async upload(params: UploadParams): Promise<UploadResult> {
    return this.driver.upload(params);
  }

  async getUrl(storageKey: string, ttlSeconds?: number): Promise<string> {
    return this.driver.getUrl(storageKey, ttlSeconds);
  }

  async presignPutUrl(
    storageKey: string,
    contentType: string,
    ttlSeconds?: number,
  ): Promise<string> {
    if (!this.driver.presignPutUrl) {
      throw new Error('Driver de storage no soporta presigned URLs.');
    }
    return this.driver.presignPutUrl(storageKey, contentType, ttlSeconds);
  }

  async delete(storageKey: string): Promise<void> {
    return this.driver.delete(storageKey);
  }
}
