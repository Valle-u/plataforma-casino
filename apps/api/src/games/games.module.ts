import { Module } from '@nestjs/common';
import { HouseModule } from '../house/house.module';
import { WalletModule } from '../wallet/wallet.module';
import { TenantSettingsModule } from '../tenant-settings/tenant-settings.module';
import { TenantResolverModule } from '../tenant-resolver/tenant-resolver.module';
import { GameProviderLogsModule } from './game-provider-logs.module';
import { GameRoundsService } from './game-rounds.service';
import { GameSessionsService } from './game-sessions.service';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { GameProvidersController } from './game-providers.controller';
import { GameProvidersService } from './game-providers.service';
import { GameProviderPingCron } from './game-provider-ping.cron';
import { GameProviderLogsRetentionCron } from './game-provider-logs-retention.cron';
import { GameProviderRegistry } from './providers/game-provider.registry';
import { ProviderBackendRegistry } from './providers/provider-backend.registry';
import { PalaceModule } from './providers/palace/palace.module';
import { ForeverModule } from './providers/forever/forever.module';

/**
 * GamesModule — catálogo + sessions + rounds + providers.
 *
 * Sprint 34: catálogo + lobby.
 * Sprint 35: agregado IGameProvider + GameSessionsService + GameRoundsService
 * para el ciclo bet/win/rollback. WalletModule
 * importado para wallet operations dentro de las TX de rounds.
 *
 * Responsible gaming es @Global, no requiere import.
 */
@Module({
  // HouseModule (B-build-4b): BettingCapsService para enforce de topes en el
  // camino de la apuesta (GameRoundsService).
  imports: [
    WalletModule,
    HouseModule,
    PalaceModule,
    ForeverModule,
    TenantSettingsModule,
    TenantResolverModule,
    GameProviderLogsModule,
  ],
  controllers: [GamesController, GameProvidersController],
  providers: [
    GamesService,
    GameSessionsService,
    GameRoundsService,
    GameProviderRegistry,
    ProviderBackendRegistry,
    GameProvidersService,
    GameProviderPingCron,
    GameProviderLogsRetentionCron,
  ],
  exports: [GamesService, GameSessionsService, GameRoundsService],
})
export class GamesModule {}
