/**
 * PromotionsModule — sorteos y actividades (doc 15 §B).
 *
 * Sprint actual cubre `daily_wheel`. Schema soporta los 6 types
 * (lottery_tickets, lottery_ranking, missions, daily_wheel, login_streak,
 * level_chests); los demás se irán implementando con su lógica específica
 * en sprints futuros usando el mismo schema base.
 */

import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { DailyWheelService } from './daily-wheel.service';
import { LoginStreakService } from './login-streak.service';
import { PromotionPrizeAwarder } from './prize-awarder.service';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [WalletModule],
  controllers: [PromotionsController],
  providers: [
    PromotionsService,
    PromotionPrizeAwarder,
    DailyWheelService,
    LoginStreakService,
  ],
  exports: [
    PromotionsService,
    PromotionPrizeAwarder,
    DailyWheelService,
    LoginStreakService,
  ],
})
export class PromotionsModule {}
