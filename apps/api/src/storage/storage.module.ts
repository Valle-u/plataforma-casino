/**
 * StorageModule — Sprint 51.6.
 *
 * @Global — el StorageService es inyectable desde cualquier módulo sin
 * reimportar (uploads de comprobantes, bonos, etc).
 *
 * Selección del driver via env STORAGE_DRIVER=local|r2.
 *   - local → LocalDiskDriver (dev/CI, archivos en disco).
 *   - r2    → R2Driver (prod, Cloudflare R2 + signed URLs).
 *
 * Registra también StorageController (sirve archivos del disco local)
 * y StorageHealthController (smoke test endpoint).
 */

import { Global, Module } from '@nestjs/common';
import { LocalDiskDriver } from './local-disk-driver';
import { R2Driver } from './r2-driver';
import { StorageController } from './storage.controller';
import { StorageHealthController } from './storage-health.controller';
import { StorageService } from './storage.service';
import { STORAGE_DRIVER_TOKEN } from './storage.tokens';

const driverFactory = {
  provide: STORAGE_DRIVER_TOKEN,
  useFactory: () => {
    const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
    if (driver === 'r2') {
      return new R2Driver();
    }
    return new LocalDiskDriver();
  },
};

@Global()
@Module({
  controllers: [StorageController, StorageHealthController],
  providers: [driverFactory, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
