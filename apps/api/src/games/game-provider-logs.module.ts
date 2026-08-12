/**
 * GameProviderLogsModule — provee GameProviderLogsService.
 *
 * Módulo "hoja" (sin dependencias de otros módulos de negocio) para poder
 * importarlo tanto desde GamesModule como desde PalaceModule sin crear
 * imports circulares (GamesModule ya importa PalaceModule).
 */

import { Module } from '@nestjs/common';
import { GameProviderLogsService } from './game-provider-logs.service';

@Module({
  providers: [GameProviderLogsService],
  exports: [GameProviderLogsService],
})
export class GameProviderLogsModule {}
