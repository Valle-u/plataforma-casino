/**
 * FraudModule — antifraude transversal (doc 15 §D).
 *
 * Exporta `FraudDetectionService` para que otros módulos (leagues,
 * promotions futuro) consulten `isUserFlagged()` antes de incluir
 * users en rankings/sorteos.
 */

import { Module } from '@nestjs/common';
import { FraudDetectionService } from './fraud-detection.service';
import { FraudScanCron } from './fraud-scan.cron';
import { FraudController } from './fraud.controller';

@Module({
  controllers: [FraudController],
  providers: [FraudDetectionService, FraudScanCron],
  exports: [FraudDetectionService],
})
export class FraudModule {}
