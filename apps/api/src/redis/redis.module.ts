/**
 * RedisModule — conexión centralizada a Redis (Upstash / Railway / local).
 *
 * Exporta RedisService para que cualquier módulo pueda usar cache,
 * locks distribuidos, pub/sub, etc.
 *
 * Sprint 56: módulo base. Los consumers (rate limit distribuido,
 * effective-permissions cache, Socket.io adapter, BullMQ) se cablean
 * en sprints siguientes.
 */

import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
