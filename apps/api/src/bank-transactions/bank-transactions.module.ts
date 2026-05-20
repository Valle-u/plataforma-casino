/**
 * BankTransactionsModule — Sprint 50.
 *
 * Provee CRUD + matching de transferencias bancarias entrantes. El
 * empleado de confianza las sube, el cajero las matchea con deposits
 * antes de aprobar (separación de funciones).
 *
 * Exporta el service para que `DepositsService.approve` valide que el
 * deposit tiene una bank_tx asociada antes de aprobar.
 */

import { Module } from '@nestjs/common';
import { BankTransactionsController } from './bank-transactions.controller';
import { BankTransactionsService } from './bank-transactions.service';

@Module({
  controllers: [BankTransactionsController],
  providers: [BankTransactionsService],
  exports: [BankTransactionsService],
})
export class BankTransactionsModule {}
