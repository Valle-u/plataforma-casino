import { Module } from '@nestjs/common';
import { HouseModule } from '../house/house.module';
import { WalletModule } from '../wallet/wallet.module';
import { TenantSettingsModule } from '../tenant-settings/tenant-settings.module';
import { TenantResolverModule } from '../tenant-resolver/tenant-resolver.module';
import { GameProviderLogsModule } from './game-provider-logs.module';
import { GameSessionsService } from './game-sessions.service';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { GamesCatalogCache } from './games-catalog-cache.service';
import { GameProvidersController } from './game-providers.controller';
import { GameProvidersService } from './game-providers.service';
import { GameProviderPingCron } from './game-provider-ping.cron';
import { GameProviderLogsRetentionCron } from './game-provider-logs-retention.cron';
import { GameProviderRegistry } from './providers/game-provider.registry';
import { ProviderBackendRegistry } from './providers/provider-backend.registry';
import { PalaceModule } from './providers/palace/palace.module';
import { ForeverModule } from './providers/forever/forever.module';
import { GregmornModule } from './providers/gregmorn/gregmorn.module';

/**
 * GamesModule — catálogo + sessions + providers.
 *
 * Sprint 34: catálogo + lobby.
 * Sprint 35: IGameProvider + GameSessionsService para el lifecycle de sesión
 * (launch/close). Los proveedores reales (Palace, Forever) son SEAMLESS: la
 * apuesta y el settle ocurren dentro del proveedor y se reconcilian por
 * callback — no hay loop de apuesta interno. WalletModule importado para
 * wallet operations del lifecycle.
 *
 * Responsible gaming es @Global, no requiere import.
 */
@Module({
  imports: [
    WalletModule,
    HouseModule,
    PalaceModule,
    ForeverModule,
    GregmornModule,
    TenantSettingsModule,
    TenantResolverModule,
    GameProviderLogsModule,
  ],
  controllers: [GamesController, GameProvidersController],
  providers: [
    GamesCatalogCache,
    GamesService,
    GameSessionsService,
    GameProviderRegistry,
    ProviderBackendRegistry,
    GameProvidersService,
    GameProviderPingCron,
    GameProviderLogsRetentionCron,
  ],
  exports: [GamesService, GameSessionsService],
})
export class GamesModule {}
