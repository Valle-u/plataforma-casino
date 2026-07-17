import { Module } from '@nestjs/common';
import { HouseModule } from '../house/house.module';
import { WalletModule } from '../wallet/wallet.module';
import { GameRoundsService } from './game-rounds.service';
import { GameSessionsService } from './game-sessions.service';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { GameProviderRegistry } from './providers/game-provider.registry';
import { PalaceModule } from './providers/palace/palace.module';

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
  imports: [WalletModule, HouseModule, PalaceModule],
  controllers: [GamesController],
  providers: [
    GamesService,
    GameSessionsService,
    GameRoundsService,
    GameProviderRegistry,
  ],
  exports: [GamesService, GameSessionsService, GameRoundsService],
})
export class GamesModule {}
