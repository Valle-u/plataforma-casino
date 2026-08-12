import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { COMMISSION_SETTLEMENT_QUEUE } from '../queue/queue.constants';
import type { SettlementJobData } from './commission-settlement.types';

@Injectable()
export class CommissionQueueService {
  private readonly logger = new Logger(CommissionQueueService.name);

  constructor(private readonly queues: QueueService) {}

  async enqueueSettlement(
    tenantSlug: string,
    params: SettlementJobData['params'],
  ): Promise<{ jobId: string | undefined }> {
    const queue = this.queues.getQueue(COMMISSION_SETTLEMENT_QUEUE);

    // El jobId de BullMQ NO puede contener ':' (BullMQ v5). El periodStart es un
    // ISO que trae ':' (00:00:00), así que sanitizamos toda la key. Mantiene la
    // idempotencia por (tenant, período/filas).
    const idempotencyKey =
      `settle_${tenantSlug}_${params.periodStart ?? 'manual'}_${(params.rowIds ?? []).join(',')}`.replace(
        /:/g,
        '-',
      );

    const job = await queue.add(
      'settle',
      { tenantSlug, params } satisfies SettlementJobData,
      {
        jobId: idempotencyKey,
      },
    );

    this.logger.log(
      `Enqueued commission settlement job ${job.id} for tenant ${tenantSlug}`,
    );
    return { jobId: job.id };
  }
}
