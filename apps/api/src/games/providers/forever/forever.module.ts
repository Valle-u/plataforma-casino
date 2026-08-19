/**
 * ForeverModule — módulo del 2º proveedor de juegos (Forever, seamless).
 *
 * F1: cliente Main API (firmado Ed25519) + sync de catálogo + backend admin.
 * F2: callback seamless (GetBalance/ChangeBalance) que mueve fichas.
 */

import { Module } from '@nestjs/common';
import { WalletModule } from '../../../wallet/wallet.module';
import { TenantResolverModule } from '../../../tenant-resolver/tenant-resolver.module';
import { TenantSettingsModule } from '../../../tenant-settings/tenant-settings.module';
import { GameProviderLogsModule } from '../../game-provider-logs.module';
import { ForeverClient } from './forever-client';
import { ForeverSyncService } from './forever-sync.service';
import { ForeverProviderBackend } from './forever-provider-backend';
import { ForeverGameProvider } from './forever-game-provider';
import { ForeverCallbackService } from './forever-callback.service';
import { ForeverCallbackController } from './forever-callback.controller';

@Module({
  imports: [
    WalletModule,
    TenantResolverModule,
    TenantSettingsModule,
    GameProviderLogsModule,
  ],
  controllers: [ForeverCallbackController],
  providers: [
    ForeverClient,
    ForeverSyncService,
    ForeverProviderBackend,
    ForeverGameProvider,
    ForeverCallbackService,
  ],
  exports: [
    ForeverClient,
    ForeverSyncService,
    ForeverProviderBackend,
    ForeverGameProvider,
  ],
})
export class ForeverModule {}
