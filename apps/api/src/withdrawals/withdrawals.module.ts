import { Module } from '@nestjs/common';
import { HouseModule } from '../house/house.module';
import { WalletModule } from '../wallet/wallet.module';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

/**
 * WithdrawalsModule — flujo de retiro del jugador con holds.
 *
 * Depende de WalletModule porque `markPaid` ejecuta debit + hold release vía
 * `WalletService.debitWithHoldReleaseAndTransfer`. Depende de HouseModule
 * porque `create` snapshotea el issuer (F3) y `markPaid` puede resolver un
 * fallback en vivo para withdrawals pre-F3 sin snapshot.
 */
@Module({
  imports: [WalletModule, HouseModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
