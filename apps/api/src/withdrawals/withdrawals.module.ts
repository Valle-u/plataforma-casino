import { Module } from '@nestjs/common';
import { BankTransactionsModule } from '../bank-transactions/bank-transactions.module';
import { HouseModule } from '../house/house.module';
import { WalletModule } from '../wallet/wallet.module';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

/**
 * WithdrawalsModule — flujo de retiro del jugador con holds.
 *
 * Depende de WalletModule porque `markPaid` ejecuta debit + hold release vía
 * `WalletService.debitWithHoldRelease` (post-F7: burn puro; el issuer
 * snapshotteado paga fiat afuera, no recibe fichas). Depende de HouseModule
 * porque `create` snapshotea el issuer (F3) como metadata contable — sirve
 * para saber qué banco tiene que pagar el fiat aunque la jerarquía del
 * player cambie entre create y paid.
 *
 * Fase 2: depende de BankTransactionsModule para el endpoint compuesto
 * `pay-in-full` (upload outgoing + match + markPaid en una sola TX).
 */
@Module({
  imports: [WalletModule, HouseModule, BankTransactionsModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
