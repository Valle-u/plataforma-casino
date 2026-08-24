import { Global, Module } from '@nestjs/common';
import { TurnstileService } from './turnstile.service';

/**
 * Módulo global de Turnstile: expone TurnstileService a cualquier módulo
 * (tenant-auth, withdrawals) sin reimportar. ConfigModule ya es global.
 */
@Global()
@Module({
  providers: [TurnstileService],
  exports: [TurnstileService],
})
export class TurnstileModule {}
