/**
 * HostHealthModule — el cron que vigila disco, memoria y carga del servidor.
 *
 * No expone controllers: sólo corre y avisa. `AlertsService` y `CronLockService`
 * llegan solos porque sus módulos son `@Global()`.
 */

import { Module } from '@nestjs/common';
import { HostHealthCron } from './host-health.cron';

@Module({
  providers: [HostHealthCron],
})
export class HostHealthModule {}
