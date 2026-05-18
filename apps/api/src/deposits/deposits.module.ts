import { Module } from '@nestjs/common';
import { BonusesModule } from '../bonuses/bonuses.module';
import { CommissionsModule } from '../commissions/commissions.module';
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
 */
@Module({
  imports: [WalletModule, BonusesModule, CommissionsModule],
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
