import { Module } from '@nestjs/common';
import { HouseModule } from '../house/house.module';
import { QueueModule } from '../queue/queue.module';
import { WalletModule } from '../wallet/wallet.module';
import { UserHierarchyModule } from '../user-hierarchy/user-hierarchy.module';
import { CommissionQueueService } from './commission-queue.service';
import { CommissionSettlementWorker } from './commission-settlement.worker';
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
 * QueueModule: la liquidación (C3) se encola via BullMQ para procesamiento
 * asíncrono. CommissionSettlementWorker procesa los jobs en background.
 *
 * WalletModule + HouseModule: el liquidador paga DESDE la Casa
 * (housePayCommission) o quema fichas (houseBurn) en plata real.
 */
@Module({
  imports: [WalletModule, HouseModule, QueueModule, UserHierarchyModule],
  controllers: [CommissionsController],
  providers: [
    CommissionsService,
    NetworkCommissionsService,
    CommissionQueueService,
    CommissionSettlementWorker,
  ],
  exports: [CommissionsService, NetworkCommissionsService],
})
export class CommissionsModule {}
