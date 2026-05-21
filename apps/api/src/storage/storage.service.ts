/**
 * StorageService — Sprint 51.6.
 *
 * Fachada del subsistema de storage. Delega en el driver activo
 * (LocalDiskDriver o R2Driver) seleccionado en `StorageModule` según
 * `process.env.STORAGE_DRIVER`. Los callers (controllers de deposits,
 * bonuses, etc.) inyectan esta clase y no se enteran del driver.
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

  upload(params: UploadParams): Promise<UploadResult> {
    return this.driver.upload(params);
  }

  getUrl(storageKey: string, ttlSeconds?: number): Promise<string> {
    return this.driver.getUrl(storageKey, ttlSeconds);
  }

  delete(storageKey: string): Promise<void> {
    return this.driver.delete(storageKey);
  }
}
