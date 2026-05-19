import { Module } from '@nestjs/common';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

/**
 * GamesModule — catálogo de juegos.
 *
 * Sprint 34: solo CRUD + listing. Sprint 35 sumará GameSessionsService +
 * GameRoundsService + IGameProvider adapter para el ciclo bet/win.
 */
@Module({
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
