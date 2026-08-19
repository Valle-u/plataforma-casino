/**
 * PalaceModule — módulo del proveedor Palace Casino.
 *
 * Sync: MANUAL únicamente. El sync automático (startup + cron periódico) se
 * removió a propósito — el catálogo se sincroniza solo cuando el admin aprieta
 * "Sincronizar" en Game Providers (cada sync pisa el estado al del proveedor,
 * así que lo dispara el operador cuando quiere).
 */

import { Module } from '@nestjs/common';
import { PalaceCallbackController } from './palace-callback.controller';
import { PalaceAdminController } from './palace-admin.controller';
import { PalaceCallbackService } from './palace-callback.service';
import { PalaceClient } from './palace-client';
import { PalaceGameProvider } from './palace-game-provider';
import { PalaceSyncService } from './palace-sync.service';
import { PalaceProviderBackend } from './palace-provider-backend';
import { WalletModule } from '../../../wallet/wallet.module';
import { TenantResolverModule } from '../../../tenant-resolver/tenant-resolver.module';
import { TenantSettingsModule } from '../../../tenant-settings/tenant-settings.module';
import { GameProviderLogsModule } from '../../game-provider-logs.module';

@Module({
  imports: [
    WalletModule,
    TenantResolverModule,
    TenantSettingsModule,
    GameProviderLogsModule,
  ],
  controllers: [PalaceCallbackController, PalaceAdminController],
  providers: [
    PalaceCallbackService,
    PalaceClient,
    PalaceGameProvider,
    PalaceSyncService,
    PalaceProviderBackend,
  ],
  exports: [
    PalaceClient,
    PalaceGameProvider,
    PalaceSyncService,
    PalaceProviderBackend,
  ],
})
export class PalaceModule {}