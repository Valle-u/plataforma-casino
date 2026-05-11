import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * WalletModule — área de alta sensibilidad (CLAUDE.md). Plata real.
 *
 * Provee `WalletService` (no global por ahora; cualquier módulo que lo
 * necesite lo importa explícitamente — más restrictivo, mejor para
 * razonar quién toca wallet).
 */
@Module({
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
