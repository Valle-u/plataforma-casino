import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, type QueueOptions } from 'bullmq';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly redis: RedisService) {}

  /**
   * Obtiene o crea una cola BullMQ reutilizando la conexión Redis.
   */
  getQueue(name: string, opts?: Partial<QueueOptions>): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;

    const client = this.redis.getBullmqConnection();
    if (!client) {
      throw new Error(
        `Cannot create queue "${name}" — Redis is disabled. Set REDIS_URL.`,
      );
    }

    const queue = new Queue(name, {
      connection: client,
      defaultJobOptions: {
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 14 * 24 * 3600 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
      ...opts,
    });

    this.queues.set(name, queue);
    this.logger.log(`BullMQ queue "${name}" ready`);
    return queue;
  }

  async onModuleDestroy(): Promise<void> {
    for (const [name, queue] of this.queues) {
      await queue.close();
      this.logger.log(`BullMQ queue "${name}" closed`);
    }
  }
}
