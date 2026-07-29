import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './dto/payment-method.dto';
import {
  PaymentMethodCodeConflictError,
  PaymentMethodNotFoundError,
} from './payment-methods.errors';
import { NodePaymentMethodsService } from './node-payment-methods.service';

@Controller('tenant/branches/payment-methods')
@UseGuards(TenantJwtGuard)
@PanelOnly()
export class NodePaymentMethodsController {
  constructor(
    private readonly service: NodePaymentMethodsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  async list(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const data = await this.service.listByOwner(db, actor.id);
    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreatePaymentMethodDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let created;
    try {
      created = await this.service.create(db, actor.id, dto);
    } catch (err) {
      if (err instanceof PaymentMethodCodeConflictError) {
        throw new ConflictException({
          message: err.message,
          error: 'PAYMENT_METHOD_CODE_CONFLICT',
        });
      }
      throw err;
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'node_payment_method.create',
      targetType: 'payment_method',
      targetId: created.id,
      after: {
        code: created.code,
        type: created.type,
        chipsPerUnit: created.chipsPerUnit,
        isActive: created.isActive,
      },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return created;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.update(db, id, actor.id, dto);
    } catch (err) {
      if (err instanceof PaymentMethodNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'PAYMENT_METHOD_NOT_FOUND',
        });
      }
      throw err;
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'node_payment_method.edit',
      targetType: 'payment_method',
      targetId: id,
      before: { name: before.name, isActive: before.isActive },
      after: {
        name: dto.name ?? before.name,
        isActive: dto.isActive ?? before.isActive,
      },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return before; // return the updated record
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.archive(db, id, actor.id);
    } catch (err) {
      if (err instanceof PaymentMethodNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'PAYMENT_METHOD_NOT_FOUND',
        });
      }
      throw err;
    }
    if (before.isActive) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'node_payment_method.archive',
        targetType: 'payment_method',
        targetId: id,
        before: { isActive: true },
        after: { isActive: false },
        metadata: { severity: 'medium' },
        ...extractRequestContext(req),
      });
    }
    return before;
  }
}
