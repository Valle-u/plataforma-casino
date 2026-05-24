/**
 * VipModule — Sprint 52.3.
 *
 * Exporta VipService porque DepositsModule lo inyecta para aplicar el
 * bonus al aprobar deposits.
 */

import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { VipController } from './vip.controller';
import { VipService } from './vip.service';

@Module({
  imports: [WalletModule],
  controllers: [VipController],
  providers: [VipService],
  exports: [VipService],
})
export class VipModule {}
