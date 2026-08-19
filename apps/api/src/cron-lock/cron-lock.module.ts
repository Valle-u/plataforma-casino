import { Global, Module } from '@nestjs/common';
import { CronLockService } from './cron-lock.service';

/**
 * CronLockModule — provee CronLockService globalmente para que cualquier cron
 * pueda envolver su tick con leader-election cross-instancia sin importar el
 * módulo. Depende de CONTROL_DB (global vía DatabaseModule).
 */
@Global()
@Module({
  providers: [CronLockService],
  exports: [CronLockService],
})
export class CronLockModule {}
