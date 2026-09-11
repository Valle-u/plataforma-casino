/**
 * PromotionsModule — sorteos y actividades (doc 15 §B).
 *
 * Sprint actual cubre `daily_wheel`. Schema soporta los 6 types
 * (lottery_tickets, lottery_ranking, missions, daily_wheel, login_streak,
 * level_chests); los demás se irán implementando con su lógica específica
 * en sprints futuros usando el mismo schema base.
 */

import { Module } from '@nestjs/common';
import { BonusesModule } from '../bonuses/bonuses.module';
import { WalletModule } from '../wallet/wallet.module';
import { DailyWheelService } from './daily-wheel.service';
import { LoginStreakService } from './login-streak.service';
import { PromotionPrizeAwarder } from './prize-awarder.service';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { WheelEligibilityService } from './wheel-eligibility.service';

@Module({
  // BonusesModule provee UserBonusesService que el PrizeAwarder usa para
  // dispatchear premios kind=bonus desde wheel/streak.
  //
  // `UserHierarchyService` y `ResponsibleGamingService`, que usa
  // WheelEligibilityService, vienen de módulos @Global: no hace falta
  // importarlos acá.
  imports: [WalletModule, BonusesModule],
  controllers: [PromotionsController],
  providers: [
    PromotionsService,
    PromotionPrizeAwarder,
    DailyWheelService,
    LoginStreakService,
    WheelEligibilityService,
  ],
  exports: [
    PromotionsService,
    PromotionPrizeAwarder,
    DailyWheelService,
    LoginStreakService,
    WheelEligibilityService,
  ],
})
export class PromotionsModule {}
