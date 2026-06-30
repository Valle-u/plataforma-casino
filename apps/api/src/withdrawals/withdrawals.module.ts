import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

/**
 * WithdrawalsModule — flujo de retiro del jugador con holds.
 *
 * Depende de WalletModule porque `markPaid` ejecuta debit + hold release vía
 * `WalletService.debitWithHoldRelease`. (El revenue share viejo sobre retiros
 * ya se había removido; el modelo de comisiones ahora es por red.)
 */
@Module({
  imports: [WalletModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
