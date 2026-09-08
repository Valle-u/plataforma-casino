/**
 * HealthReportModule — el parte diario por Telegram.
 *
 * Sin controllers: sólo corre y manda. `AlertsService` y `CronLockService`
 * llegan solos porque sus módulos son `@Global()`. Mismo patrón que
 * `UploadsBackupModule` y `HostHealthModule`.
 */

import { Module } from '@nestjs/common';
import { HealthReportCron } from './health-report.cron';

@Module({
  providers: [HealthReportCron],
})
export class HealthReportModule {}
