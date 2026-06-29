/**
 * HouseController — panel de la Casa / tesorería (Blindaje, Parte B).
 *
 *   - GET  /tenant/house                     (house.view)        estado de la Casa
 *   - POST /tenant/house/inject-capital      (house.inject_capital) aportar capital
 *   - GET  /tenant/house/capital-injections  (house.view)        historial de aportes
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { InjectCapitalDto } from './dto/inject-capital.dto';
import {
  HouseBankTxAlreadyMatchedError,
  HouseBankTxNotFoundError,
  HouseBankTxNotIncomingError,
} from './house.errors';
import { HouseNotProvisionedError, HouseService } from './house.service';
import { BettingCapsService } from './betting-caps.service';
import { SetBettingCapsDto } from './dto/betting-caps.dto';

@Controller('tenant/house')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class HouseController {
  constructor(
    private readonly service: HouseService,
    private readonly bettingCaps: BettingCapsService,
    private readonly audit: AuditLogService,
  ) {}

  private requireDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
    return req.tenantContext.db;
  }

  /** GET /tenant/house — estado de la Casa / tesorería. */
  @Get()
  @RequirePermissions('house.view')
  async state(@Req() req: RequestWithTenantContext) {
    const db = this.requireDb(req);
    try {
      return await this.service.getHouseState(db);
    } catch (err) {
      if (err instanceof HouseNotProvisionedError) {
        throw new NotFoundException({
          message: err.message,
          error: 'HOUSE_NOT_PROVISIONED',
        });
      }
      throw err;
    }
  }

  /**
   * POST /tenant/house/inject-capital — aporte de capital del dueño a la Casa,
   * atado a una transferencia bancaria entrante. Mintea a la Casa. Severity high.
   */
  @Post('inject-capital')
  @RequirePermissions('house.inject_capital')
  @HttpCode(HttpStatus.CREATED)
  async injectCapital(
    @Body() dto: InjectCapitalDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    try {
      const injection = await this.service.injectCapital(db, {
        bankTransactionId: dto.bankTransactionId,
        actorUserId: actor.id,
        notes: dto.notes ?? null,
      });
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'house.inject_capital',
        targetType: 'house_capital_injection',
        targetId: injection.id,
        metadata: {
          amount: injection.amount,
          bankTransactionId: injection.bankTransactionId,
          mintTxId: injection.mintTxId,
          severity: 'high',
        },
        ...extractRequestContext(req),
      });
      return injection;
    } catch (err) {
      if (err instanceof HouseNotProvisionedError) {
        throw new NotFoundException({
          message: err.message,
          error: 'HOUSE_NOT_PROVISIONED',
        });
      }
      if (err instanceof HouseBankTxNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'BANK_TX_NOT_FOUND',
        });
      }
      if (err instanceof HouseBankTxNotIncomingError) {
        throw new BadRequestException({
          message: err.message,
          error: 'BANK_TX_NOT_INCOMING',
        });
      }
      if (err instanceof HouseBankTxAlreadyMatchedError) {
        throw new ConflictException({
          message: err.message,
          error: 'BANK_TX_ALREADY_MATCHED',
        });
      }
      throw err;
    }
  }

  /** GET /tenant/house/capital-injections — historial de aportes. */
  @Get('capital-injections')
  @RequirePermissions('house.view')
  async capitalInjections(
    @Req() req: RequestWithTenantContext,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = this.requireDb(req);
    return this.service.listInjections(
      db,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
  }

  /** GET /tenant/house/betting-caps — topes + turnover del mes (panel). */
  @Get('betting-caps')
  @RequirePermissions('house.view')
  async bettingCapsStatus(@Req() req: RequestWithTenantContext) {
    const db = this.requireDb(req);
    return this.bettingCaps.getStatus(db);
  }

  /** PATCH /tenant/house/betting-caps — setea los topes (0 = sin tope). */
  @Patch('betting-caps')
  @RequirePermissions('tenant.settings.edit')
  async setBettingCaps(
    @Body() dto: SetBettingCapsDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = this.requireDb(req);
    await this.bettingCaps.setCaps(
      db,
      { playerMonthly: dto.playerMonthly, globalMonthly: dto.globalMonthly },
      actor.id,
    );
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'house.set_betting_caps',
      targetType: 'betting_caps',
      metadata: {
        playerMonthly: dto.playerMonthly,
        globalMonthly: dto.globalMonthly,
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });
    return this.bettingCaps.getStatus(db);
  }
}
