/**
 * BonusesModule — sistema de bonos (Sprint Bonos-1 MVP).
 *
 * Cubre:
 *   - CRUD de `bonus_definitions` (plantillas configurables).
 *   - Grant manual que credita `bonus_balance` (dual wallet).
 */

import { Module } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { HouseModule } from '../house/house.module';
import { WalletModule } from '../wallet/wallet.module';
import { BonusDefinitionsController } from './bonus-definitions.controller';
import { BonusDefinitionsService } from './bonus-definitions.service';
import { UserBonusesController } from './user-bonuses.controller';
import { UserBonusesService } from './user-bonuses.service';

@Module({
  // HouseModule: provee `EmployeeCorrectionService`, que el grant manual usa
  // para validar el cupo mensual del empleado (LEYES R7, docs/19).
  imports: [WalletModule, FraudModule, HouseModule],
  controllers: [BonusDefinitionsController, UserBonusesController],
  providers: [
    BonusDefinitionsService,
    UserBonusesService,
  ],
  exports: [
    BonusDefinitionsService,
    UserBonusesService,
  ],
})
export class BonusesModule {}
