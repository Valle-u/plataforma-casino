/**
 * AchievementsModule — Sprint 52.2.
 *
 * Sistema de achievements server-side. Depende de:
 *   - WalletModule para mintear chips como reward (mintToWallet).
 *
 * No requiere cron por ahora — el check se dispara explícitamente:
 *   - POST /tenant/achievements/me/check desde el cliente.
 *   - Futuro: hooks server-side al cierre de promo/deposit/etc.
 */

import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

@Module({
  imports: [WalletModule],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
