/**
 * HouseModule — Blindaje del núcleo económico, Parte B (tesorería).
 *
 * Expone la cuenta "Casa" (system user) del tenant: la única fuente de fichas y
 * la contraparte de todo. B-build-1: resolución + estado (view). El HouseService
 * se exporta para que las fases siguientes (juego, premiaciones, depósitos)
 * resuelvan la wallet de la Casa.
 */

import { Module } from '@nestjs/common';
import { HouseController } from './house.controller';
import { HouseService } from './house.service';

@Module({
  controllers: [HouseController],
  providers: [HouseService],
  exports: [HouseService],
})
export class HouseModule {}
