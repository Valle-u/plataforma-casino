/**
 * PaymentMethodsController — endpoints del catálogo de métodos del tenant.
 *
 * Endpoints:
 *   GET    /tenant/payment-methods?activeOnly=true (default)
 *     - Lectura pública (user logueado). Sin permission extra.
 *   GET    /tenant/payment-methods/:id
 *     - Lectura pública. Para el detail drawer del panel admin.
 *   POST   /tenant/payment-methods
 *     - Crear. Requiere `payment_methods.edit`. Audit `payment_method.create`.
 *   PATCH  /tenant/payment-methods/:id
 *     - Update parcial (name/config/isActive). NO permite cambiar `type`
 *       (rompería supuestos de deposits/withdrawals viejos).
 *     - Requiere `payment_methods.edit`. Audit `payment_method.edit`.
 *   POST   /tenant/payment-methods/:id/archive
 *     - Soft-delete (is_active=false). Idempotente.
 *     - Requiere `payment_methods.edit`. Audit `payment_method.archive`.
 *
 * No exponemos DELETE duro — los deposits/withdrawals tienen FK que se
 * romperían. El admin "archiva" y el método desaparece del dropdown del
 * jugador. Para "des-archivar", PATCH con isActive=true.
 */

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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './dto/payment-method.dto';
import {
  PaymentMethodCodeConflictError,
  PaymentMethodNotFoundError,
} from './payment-methods.errors';
import { PaymentMethodsService } from './payment-methods.service';

@Controller('tenant/payment-methods')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class PaymentMethodsController {
  constructor(
    private readonly service: PaymentMethodsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  async list(
    @Req() req: RequestWithTenantContext,
    @Query('activeOnly') activeOnly?: string,
  ) {
    const db = req.tenantContext!.db;
    const data = await this.service.list(db, {
      activeOnly: activeOnly === 'false' ? false : true,
    });
    return { data };
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof PaymentMethodNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'PAYMENT_METHOD_NOT_FOUND',
        });
      }
      throw err;
    }
  }

  @Post()
  @RequirePermissions('payment_methods.edit')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreatePaymentMethodDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let created;
    try {
      created = await this.service.create(db, dto);
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
      actionCode: 'payment_method.create',
      targetType: 'payment_method',
      targetId: created.id,
      after: {
        code: created.code,
        type: created.type,
        isActive: created.isActive,
      },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return created;
  }

  @Patch(':id')
  @RequirePermissions('payment_methods.edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof PaymentMethodNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'PAYMENT_METHOD_NOT_FOUND',
        });
      }
      throw err;
    }
    const updated = await this.service.update(db, id, dto);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'payment_method.edit',
      targetType: 'payment_method',
      targetId: id,
      before: { name: before.name, isActive: before.isActive },
      after: { name: updated.name, isActive: updated.isActive },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return updated;
  }

  @Post(':id/archive')
  @RequirePermissions('payment_methods.edit')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof PaymentMethodNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'PAYMENT_METHOD_NOT_FOUND',
        });
      }
      throw err;
    }
    const updated = await this.service.archive(db, id);
    // Audit solo si efectivamente cambió el flag (skip si ya estaba archivado).
    if (before.isActive) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'payment_method.archive',
        targetType: 'payment_method',
        targetId: id,
        before: { isActive: true },
        after: { isActive: false },
        metadata: { severity: 'medium' },
        ...extractRequestContext(req),
      });
    }
    return updated;
  }
}
