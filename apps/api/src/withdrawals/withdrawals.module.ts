import { Module } from '@nestjs/common';
import { CommissionsModule } from '../commissions/commissions.module';
import { WalletModule } from '../wallet/wallet.module';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

/**
 * WithdrawalsModule — flujo de retiro del jugador con holds.
 *
 * Depende de:
 *   - WalletModule porque `markPaid` ejecuta debit + hold release vía
 *     `WalletService.debitWithHoldRelease`.
 *   - CommissionsModule porque `markPaid` dispara revenue share a la
 *     jerarquía upstream del cliente vía `CommissionsService.applyForEvent`
 *     (Sprint 25). El approver fondea de su wallet.
 */
@Module({
  imports: [WalletModule, CommissionsModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
