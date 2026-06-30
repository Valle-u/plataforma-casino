import { Module } from '@nestjs/common';
import { BonusesModule } from '../bonuses/bonuses.module';
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
 *   - VipModule (Sprint 52.3) — aplica deposit bonus % según VIP tier
 *     del user receptor.
 *
 * Nota: el revenue share viejo (CommissionsService.applyForEvent al aprobar)
 * se eliminó — las comisiones ahora son por red (NetWin mensual).
 */
@Module({
  imports: [WalletModule, BonusesModule, VipModule],
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
