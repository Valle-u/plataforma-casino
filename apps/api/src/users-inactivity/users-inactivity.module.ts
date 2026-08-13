/**
 * UsersInactivityModule — desactivación automática de jugadores dormidos.
 *
 * Provee el service + el cron diario. TenantSettings y Audit son @Global, no
 * hace falta importarlos. La conexión por tenant la da TenantConnectionCache
 * (mismo patrón que fraud/movement-alerts).
 */

import { Module } from '@nestjs/common';
import { UsersInactivityService } from './users-inactivity.service';
import { UsersInactivityScanCron } from './users-inactivity-scan.cron';
import { UsersInactivityController } from './users-inactivity.controller';

@Module({
  controllers: [UsersInactivityController],
  providers: [UsersInactivityService, UsersInactivityScanCron],
  exports: [UsersInactivityService],
})
export class UsersInactivityModule {}
