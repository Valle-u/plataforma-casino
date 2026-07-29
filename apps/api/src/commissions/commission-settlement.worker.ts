import {
  Injectable,
  Inject,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb } from '@casino/db';
import { CONTROL_DB } from '../common/symbols';
import { RedisService } from '../redis/redis.service';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import { COMMISSION_SETTLEMENT_QUEUE } from '../queue/queue.constants';
import { NetworkCommissionsService } from './network-commissions.service';
import type { SettlementJobData, SettlementJobResult } from './commission-settlement.types';

@Injectable()
export class CommissionSettlementWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommissionSettlementWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly redis: RedisService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly network: NetworkCommissionsService,
  ) {}

  onModuleInit(): void {
    const client = this.redis.getClient();
    if (!client) {
      this.logger.warn(
        'Redis disabled — CommissionSettlementWorker not started. Set REDIS_URL to enable.',
      );
      return;
    }

    this.worker = new Worker<SettlementJobData, SettlementJobResult>(
      COMMISSION_SETTLEMENT_QUEUE,
      async (job) => {
        const { tenantSlug, params } = job.data;
        this.logger.log(
          `Processing settlement job ${job.id} for tenant "${tenantSlug}"`,
        );

        const [tenantRow] = await this.controlDb
          .select()
          .from(tenants)
          .where(eq(tenants.slug, tenantSlug))
          .limit(1);
        if (!tenantRow) {
          throw new Error(`Tenant "${tenantSlug}" not found in control DB`);
        }

        const db = this.tenantCache.get(tenantRow);

        const periodStart = params.periodStart
          ? new Date(params.periodStart)
          : undefined;

        const result = await this.network.settlePeriods(db, {
          rowIds: params.rowIds,
          periodStart,
          reference: params.reference ?? null,
          actorUserId: params.actorUserId,
        });

        this.logger.log(
          `Settlement job ${job.id} done: ${result.settled} settled, ${result.failed} failed, total ${result.totalPaid}`,
        );

        return {
          settled: result.settled,
          failed: result.failed,
          totalPaid: result.totalPaid,
        };
      },
      {
        connection: client,
        concurrency: 1,
        lockDuration: 60_000,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Settlement job ${job.id} completed`);
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Settlement job ${job?.id} failed: ${err.message}`,
        err.stack,
      );
    });
    this.worker.on('error', (err) => {
      this.logger.error(`Settlement worker error: ${err.message}`);
    });

    this.logger.log('CommissionSettlementWorker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('CommissionSettlementWorker stopped');
    }
  }
}
