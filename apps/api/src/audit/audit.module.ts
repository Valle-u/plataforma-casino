import { Global, Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

/**
 * AuditModule — registro inmutable de acciones por tenant.
 *
 * @Global porque `AuditLogService` se inyecta en handlers de muchos
 * módulos (permission-overrides, tenant-users, futuro wallet, etc.)
 * y no queremos re-importar.
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
