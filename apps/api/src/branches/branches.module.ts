/**
 * BranchesModule — Sprint 51.
 *
 * Modo "sucursal independiente" para socios + venta de fichas del
 * tenant al socio independent. Depende de WalletModule para mintear.
 */

import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { BranchesController } from './branches.controller';
import { BranchesQueryController } from './branches-query.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [WalletModule],
  controllers: [BranchesController, BranchesQueryController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
