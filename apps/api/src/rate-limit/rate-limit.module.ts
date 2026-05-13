/**
 * RateLimitModule — provee `RateLimiterService` y `RateLimitGuard` para
 * cualquier módulo downstream.
 *
 * Global porque el limiter es estado compartido entre handlers (cada
 * endpoint que use `@RateLimit()` consulta la misma instancia).
 */

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimiterService } from './rate-limiter.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RateLimiterService, RateLimitGuard],
  exports: [RateLimiterService, RateLimitGuard],
})
export class RateLimitModule {}
