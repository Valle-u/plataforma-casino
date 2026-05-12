import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

/**
 * DepositsModule — flujo de carga autoservicio del jugador.
 *
 * Depende de WalletModule porque approve() acredita fichas vía
 * `WalletService.creditFromDeposit()`. WalletModule no es @Global,
 * lo importamos explícitamente.
 */
@Module({
  imports: [WalletModule],
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
