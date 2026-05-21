/**
 * StorageModule — Sprint 51.6.
 *
 * @Global porque cualquier módulo (deposits, bonuses, etc.) puede
 * necesitar uploads sin re-importar.
 *
 * El driver se selecciona via `STORAGE_DRIVER` env (default 'local'):
 *   - 'local': LocalDiskDriver (dev/CI) — archivos en disk + endpoint
 *     `GET /storage/files/<key>` con auth via JWT del player/admin.
 *   - 'r2'   : R2Driver (prod) — Cloudflare R2 con SDK S3.
 *
 * Si emerge otro provider (S3 puro, GCS, Azure), agregar otro driver
 * que implemente `StorageDriver` y un case en el factory.
 */

import { Global, Logger, Module, type Provider } from '@nestjs/common';
import { LocalDiskDriver } from './local-disk-driver';
import { R2Driver } from './r2-driver';
import { StorageController } from './storage.controller';
import { StorageHealthController } from './storage-health.controller';
import { StorageService } from './storage.service';
import { STORAGE_DRIVER_TOKEN } from './storage.tokens';

const driverProvider: Provider = {
  provide: STORAGE_DRIVER_TOKEN,
  useFactory: () => {
    const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
    const logger = new Logger('StorageModule');
    if (driver === 'r2') {
      logger.log('Storage driver: R2 (Cloudflare).');
      return new R2Driver();
    }
    if (driver !== 'local') {
      logger.warn(
        `STORAGE_DRIVER='${driver}' no reconocido — usando 'local' por default.`,
      );
    } else {
      logger.log('Storage driver: local disk.');
    }
    return new LocalDiskDriver();
  },
};

@Global()
@Module({
  controllers: [StorageController, StorageHealthController],
  providers: [StorageService, driverProvider],
  exports: [StorageService],
})
export class StorageModule {}
