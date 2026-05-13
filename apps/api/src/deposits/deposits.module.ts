import { Module } from '@nestjs/common';
import { BonusesModule } from '../bonuses/bonuses.module';
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
 */
@Module({
  imports: [WalletModule, BonusesModule],
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
