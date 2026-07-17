/**
 * BonusesModule — sistema de bonos (Sprint Bonos-1 MVP).
 *
 * Cubre:
 *   - CRUD de `bonus_definitions` (plantillas configurables).
 *   - Grant manual que credita `bonus_balance` (dual wallet).
 */

import { Module } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { WalletModule } from '../wallet/wallet.module';
import { BonusDefinitionsController } from './bonus-definitions.controller';
import { BonusDefinitionsService } from './bonus-definitions.service';
import { UserBonusesController } from './user-bonuses.controller';
import { UserBonusesService } from './user-bonuses.service';

@Module({
  imports: [WalletModule, FraudModule],
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
