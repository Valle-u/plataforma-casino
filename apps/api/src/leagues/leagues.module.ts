/**
 * LeaguesModule — sistema de leagues / leaderboards (doc 15 §C).
 */

import { Module } from '@nestjs/common';
import { PromotionsModule } from '../promotions/promotions.module';
import { LeaguesCloseCron } from './leagues-close.cron';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

@Module({
  // PromotionsModule provee PromotionPrizeAwarder que usamos para
  // dispatchear los premios de leagues (chips/bonus/etc.).
  imports: [PromotionsModule],
  controllers: [LeaguesController],
  providers: [LeaguesService, LeaguesCloseCron],
  exports: [LeaguesService],
})
export class LeaguesModule {}
