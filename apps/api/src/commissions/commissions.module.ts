import { Module } from '@nestjs/common';
import { HouseModule } from '../house/house.module';
import { WalletModule } from '../wallet/wallet.module';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';

/**
 * CommissionsModule — revenue share a la jerarquía.
 *
 * Depende de WalletModule porque `applyForEvent` (Sprint 25) ejecuta
 * transferencias atómicas approver → beneficiary via
 * `WalletService.executeCommissionTransfer`.
 *
 * Exportado para que DepositsModule y WithdrawalsModule lo inyecten en
 * sus respectivos services y hookeen el apply automático en `approve` /
 * `markPaid`.
 */
@Module({
  // HouseModule (B-build-5): el settle paga las comisiones DESDE la Casa
  // (HouseService.getHouseUser) en vez de mintear.
  imports: [WalletModule, HouseModule],
  controllers: [CommissionsController],
  providers: [CommissionsService],
  exports: [CommissionsService],
})
export class CommissionsModule {}
