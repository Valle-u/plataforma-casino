/**
 * UploadsBackupModule — el cron que respalda los archivos subidos.
 *
 * No expone controllers: sólo corre y avisa. `AlertsService` y `CronLockService`
 * llegan solos porque sus módulos son `@Global()`. Mismo patrón que
 * `HostHealthModule`.
 */

import { Module } from '@nestjs/common';
import { UploadsBackupCron } from './uploads-backup.cron';

@Module({
  providers: [UploadsBackupCron],
})
export class UploadsBackupModule {}
