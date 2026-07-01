/**
 * HouseModule — Blindaje del núcleo económico, Parte B (tesorería).
 *
 * Expone la cuenta "Casa" (system user) del tenant: la única fuente de fichas y
 * la contraparte de todo. B-build-1: resolución + estado (view). El HouseService
 * se exporta para que las fases siguientes (juego, premiaciones, depósitos)
 * resuelvan la wallet de la Casa.
 */

import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmployeeCorrectionService } from '../wallet/employee-correction.service';
import { WalletModule } from '../wallet/wallet.module';
import { BettingCapsService } from './betting-caps.service';
import { CorrectionController } from './correction.controller';
import { HouseController } from './house.controller';
import { HouseService } from './house.service';

@Module({
  // WalletModule: el aporte de capital (B-build-3) mintea a la Casa vía
  // WalletService.mintToWallet.
  imports: [WalletModule, AuditModule],
  controllers: [HouseController, CorrectionController],
  // BettingCapsService (B-build-4b) se exporta para que GamesModule enforce
  // los topes en el camino de la apuesta.
  // EmployeeCorrectionService (docs/19): cargas manuales del empleado por
  // corrección/bonificación/reintegro, contra su cupo mensual — drena la Casa.
  providers: [HouseService, BettingCapsService, EmployeeCorrectionService],
  exports: [HouseService, BettingCapsService, EmployeeCorrectionService],
})
export class HouseModule {}
