/**
 * BonusesModule — sistema de bonos (Sprint Bonos-1 MVP).
 *
 * Cubre:
 *   - CRUD de `bonus_definitions` (plantillas configurables).
 *   - Grant manual / cancel / force-clear de `user_bonuses`.
 *
 * Fuera de scope MVP: wagering tracking, auto-grant en deposit, cashback,
 * free spins, misiones, liga, antifraude (ver docs/15-engagement-promos).
 */

import { Module } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { WalletModule } from '../wallet/wallet.module';
import { BonusDefinitionsController } from './bonus-definitions.controller';
import { BonusDefinitionsService } from './bonus-definitions.service';
import { BonusesAutoGrantService } from './bonuses-auto-grant.service';
import { BonusesCashbackCron } from './bonuses-cashback.cron';
import { BonusesCashbackService } from './bonuses-cashback.service';
import { BonusesExpirationCron } from './bonuses-expiration.cron';
import { BonusesExpirationService } from './bonuses-expiration.service';
import { UserBonusesController } from './user-bonuses.controller';
import { UserBonusesService } from './user-bonuses.service';

@Module({
  // FraudModule: BonusesAutoGrantService consulta isUserInConfirmedHighRiskCluster
  // antes de otorgar welcome/reload (doc 15 §D3).
  imports: [WalletModule, FraudModule],
  controllers: [BonusDefinitionsController, UserBonusesController],
  providers: [
    BonusDefinitionsService,
    UserBonusesService,
    BonusesAutoGrantService,
    BonusesExpirationService,
    BonusesExpirationCron,
    BonusesCashbackService,
    BonusesCashbackCron,
  ],
  exports: [
    BonusDefinitionsService,
    UserBonusesService,
    BonusesAutoGrantService,
    BonusesExpirationService,
    BonusesCashbackService,
  ],
})
export class BonusesModule {}
