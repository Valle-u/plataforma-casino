import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { NodePaymentMethodsService } from './node-payment-methods.service';

@Controller('player/payment-methods')
@UseGuards(TenantJwtGuard)
export class PlayerPaymentMethodsController {
  constructor(
    private readonly nodePm: NodePaymentMethodsService,
  ) {}

  @Get()
  async listForPlayer(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const data = await this.nodePm.listForPlayer(db, actor.id);
    return { data };
  }
}
