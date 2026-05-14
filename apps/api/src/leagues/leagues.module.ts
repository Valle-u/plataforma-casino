/**
 * LeaguesModule — sistema de leagues / leaderboards (doc 15 §C).
 */

import { Module } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { LeaguesCloseCron } from './leagues-close.cron';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

@Module({
  // PromotionsModule provee PromotionPrizeAwarder para dispatch de premios.
  // FraudModule provee FraudDetectionService para excluir users flagged
  // del recompute de standings (doc 15 §C6).
  imports: [PromotionsModule, FraudModule],
  controllers: [LeaguesController],
  providers: [LeaguesService, LeaguesCloseCron],
  exports: [LeaguesService],
})
export class LeaguesModule {}
