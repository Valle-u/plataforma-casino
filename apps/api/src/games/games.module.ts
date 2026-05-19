import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { GameRoundsService } from './game-rounds.service';
import { GameSessionsService } from './game-sessions.service';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { MockGameProvider } from './providers/mock-game-provider';
import { GameProviderRegistry } from './providers/game-provider.registry';

/**
 * GamesModule — catálogo + sessions + rounds + providers.
 *
 * Sprint 34: catálogo + lobby.
 * Sprint 35: agregado IGameProvider + MockGameProvider + GameSessionsService +
 * GameRoundsService para el ciclo bet/win/rollback. WalletModule
 * importado para wallet operations dentro de las TX de rounds.
 *
 * Responsible gaming es @Global, no requiere import.
 */
@Module({
  imports: [WalletModule],
  controllers: [GamesController],
  providers: [
    GamesService,
    GameSessionsService,
    GameRoundsService,
    MockGameProvider,
    GameProviderRegistry,
  ],
  exports: [GamesService, GameSessionsService, GameRoundsService],
})
export class GamesModule {}
