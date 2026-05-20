/**
 * GameStatsModule — Sprint 46.
 *
 * Reporting consolidado read-only sobre `game_rounds`. NO muta estado.
 * Pedido del dueño 2026-05-20 item B: "estadísticas de juego — todas
 * las jugadas, con métricas de RTP real, GGR, top winners/losers".
 *
 * Sigue el mismo patrón que WalletStatsModule (Sprint 45).
 */

import { Module } from '@nestjs/common';
import { GameStatsController } from './game-stats.controller';
import { GameStatsService } from './game-stats.service';

@Module({
  controllers: [GameStatsController],
  providers: [GameStatsService],
  exports: [GameStatsService],
})
export class GameStatsModule {}
