import { Module } from '@nestjs/common';
import { HouseModule } from '../house/house.module';
import { WalletModule } from '../wallet/wallet.module';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { NetworkCommissionsService } from './network-commissions.service';

/**
 * CommissionsModule — comisiones por red (modelo socios-only).
 *
 * El modelo viejo (reglas globales por rol + comisión sobre el depósito) se
 * eliminó por completo. `NetworkCommissionsService` computa/liquida las
 * comisiones por NetWin; `CommissionsService` solo expone `setNetworkRate`.
 *
 * WalletModule + HouseModule: el liquidador paga DESDE la Casa
 * (housePayCommission) o quema fichas (houseBurn) en plata real.
 */
@Module({
  imports: [WalletModule, HouseModule],
  controllers: [CommissionsController],
  providers: [CommissionsService, NetworkCommissionsService],
  exports: [CommissionsService, NetworkCommissionsService],
})
export class CommissionsModule {}
