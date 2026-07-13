/**
 * PalaceModule — módulo del proveedor Palace Casino.
 */

import { Module } from '@nestjs/common';
import { PalaceCallbackController } from './palace-callback.controller';
import { PalaceAdminController } from './palace-admin.controller';
import { PalaceCallbackService } from './palace-callback.service';
import { PalaceClient } from './palace-client';
import { PalaceGameProvider } from './palace-game-provider';
import { PalaceSyncService } from './palace-sync.service';
import { WalletModule } from '../../../wallet/wallet.module';
import { TenantResolverModule } from '../../../tenant-resolver/tenant-resolver.module';
import { TenantSettingsModule } from '../../../tenant-settings/tenant-settings.module';

@Module({
  imports: [
    WalletModule,
    TenantResolverModule,
    TenantSettingsModule,
  ],
  controllers: [PalaceCallbackController, PalaceAdminController],
  providers: [
    PalaceCallbackService,
    PalaceClient,
    PalaceGameProvider,
    PalaceSyncService,
  ],
  exports: [
    PalaceClient,
    PalaceGameProvider,
    PalaceSyncService,
  ],
})
export class PalaceModule {}