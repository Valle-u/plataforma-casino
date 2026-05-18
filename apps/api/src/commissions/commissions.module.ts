import { Module } from '@nestjs/common';
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
  imports: [WalletModule],
  controllers: [CommissionsController],
  providers: [CommissionsService],
  exports: [CommissionsService],
})
export class CommissionsModule {}
