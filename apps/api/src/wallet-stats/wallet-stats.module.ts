/**
 * WalletStatsModule — Sprint 45.
 *
 * Reporting consolidado read-only sobre `wallet_transactions`. NO muta
 * estado — solo agrega y filtra. Reusa el schema existente (no requiere
 * migration). Pensado para el pedido del dueño 2026-05-20:
 * "estadísticas de pago — todos los movimientos de fichas a usuarios
 * finales, cajeros, socios, distribuidores, con trazabilidad correcta".
 */

import { Module } from '@nestjs/common';
import { WalletStatsController } from './wallet-stats.controller';
import { WalletStatsService } from './wallet-stats.service';

@Module({
  controllers: [WalletStatsController],
  providers: [WalletStatsService],
  exports: [WalletStatsService],
})
export class WalletStatsModule {}
