import { Module } from '@nestjs/common';
import { HouseModule } from '../house/house.module';
import { MovementAlertsController } from './movement-alerts.controller';
import { MovementAlertsScanCron } from './movement-alerts-scan.cron';
import { MovementAlertsService } from './movement-alerts.service';

/**
 * MovementAlertsModule — "Movimientos sospechosos" (fraude interno sobre el
 * ledger). HouseModule provee HouseService + EmployeeCorrectionService; el
 * resto (notifications, audit, tenant-settings, common, user-hierarchy) es
 * global.
 */
@Module({
  imports: [HouseModule],
  controllers: [MovementAlertsController],
  providers: [MovementAlertsService, MovementAlertsScanCron],
  exports: [MovementAlertsService],
})
export class MovementAlertsModule {}
