/**
 * LedgerModule — Blindaje del núcleo económico (pre-v1), Parte A.
 *
 * Validador de invariante del ledger ("¿las fichas cuadran?"):
 *   - LedgerReconciliationService: los chequeos (read-only sobre la economía).
 *   - LedgerController: panel admin (correr on-demand + historial + supply).
 *   - LedgerReconciliationCron: corrida nocturna automática para todos los tenants.
 *
 * Sin imports: AuditLogService (AuditModule @Global), CONTROL_DB
 * (DatabaseModule @Global), TenantConnectionCache (TenantResolverModule) y
 * SchedulerRegistry (ScheduleModule.forRoot) ya están disponibles.
 */

import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerReconciliationCron } from './ledger-reconciliation.cron';
import { LedgerReconciliationService } from './ledger-reconciliation.service';

@Module({
  controllers: [LedgerController],
  providers: [LedgerReconciliationService, LedgerReconciliationCron],
  exports: [LedgerReconciliationService],
})
export class LedgerModule {}
