import { Module } from '@nestjs/common';
import { BonusesModule } from '../bonuses/bonuses.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { VipModule } from '../vip/vip.module';
import { WalletModule } from '../wallet/wallet.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

/**
 * DepositsModule — flujo de carga autoservicio del jugador.
 *
 * Depende de:
 *   - WalletModule porque `approve()` acredita fichas vía
 *     `WalletService.creditFromDeposit()`.
 *   - BonusesModule porque `approve()` dispara auto-grant de welcome/reload
 *     vía `BonusesAutoGrantService` (Sprint Bonos-2).
 *   - CommissionsModule porque `approve()` dispara el revenue share a la
 *     jerarquía upstream del cliente vía `CommissionsService.applyForEvent`
 *     (Sprint 25). El approver fondea de su wallet.
 *   - VipModule (Sprint 52.3) — aplica deposit bonus % según VIP tier
 *     del user receptor.
 */
@Module({
  imports: [WalletModule, BonusesModule, CommissionsModule, VipModule],
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
