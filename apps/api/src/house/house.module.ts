/**
 * HouseModule — Blindaje del núcleo económico, Parte B (tesorería).
 *
 * Expone la cuenta "Casa" (system user) del tenant: la única fuente de fichas y
 * la contraparte de todo. B-build-1: resolución + estado (view). El HouseService
 * se exporta para que las fases siguientes (juego, premiaciones, depósitos)
 * resuelvan la wallet de la Casa.
 */

import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { BettingCapsService } from './betting-caps.service';
import { HouseController } from './house.controller';
import { HouseService } from './house.service';

@Module({
  // WalletModule: el aporte de capital (B-build-3) mintea a la Casa vía
  // WalletService.mintToWallet.
  imports: [WalletModule],
  controllers: [HouseController],
  // BettingCapsService (B-build-4b) se exporta para que GamesModule enforce
  // los topes en el camino de la apuesta.
  providers: [HouseService, BettingCapsService],
  exports: [HouseService, BettingCapsService],
})
export class HouseModule {}
