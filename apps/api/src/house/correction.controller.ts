/**
 * CorrectionController — cargas manuales del empleado por corrección /
 * bonificación / reintegro (docs/19-cupo-empleado.md).
 *
 * Endpoints:
 *   - GET  /tenant/correction/status                 (wallet.correct) cupo del actor
 *   - POST /tenant/correction                        (wallet.correct) aplica una carga
 *   - PATCH /tenant/correction/user/:userId/cap      (users.edit)     admin fija cupo
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
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
import { eq } from 'drizzle-orm';
import { users } from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { WalletCorrectDto } from '../wallet/dto/correction.dto';
import { SetCorrectionCapDto } from '../wallet/dto/set-correction-cap.dto';
import {
  CorrectionCapExceededError,
  EmployeeCorrectionService,
  InvalidCorrectionTargetError,
  NoCorrectionCapError,
} from '../wallet/employee-correction.service';

function requireDb(req: RequestWithTenantContext) {
  if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
  return req.tenantContext.db;
}

@Controller('tenant/correction')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class CorrectionController {
  constructor(
    private readonly service: EmployeeCorrectionService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * GET /tenant/correction/status — cupo del ACTOR (el propio empleado).
   * Devuelve cap, used (este mes UTC), remaining. Si cap='0', el empleado
   * NO puede aplicar cargas por corrección aunque tenga el permiso.
   */
  @Get('status')
  @RequirePermissions('wallet.correct')
  async status(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = requireDb(req);
    return this.service.getStatus(db, actor.id);
  }

  /**
   * POST /tenant/correction — el empleado aplica una carga por corrección/
   * bonificación/reintegro. Drena de la Casa. Audit severity high.
   */
  @Post()
  @RequirePermissions('wallet.correct')
  @HttpCode(HttpStatus.CREATED)
  async apply(
    @Body() dto: WalletCorrectDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = requireDb(req);
    const idempotencyKey = `correction:${actor.id}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    try {
      const tx = await this.service.apply(db, {
        actorUserId: actor.id,
        targetUserId: dto.targetUserId,
        amount: dto.amount,
        reasonType: dto.reasonType,
        reasonNotes: dto.reasonNotes ?? null,
        idempotencyKey,
      });

      const statusAfter = await this.service.getStatus(db, actor.id);

      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'wallet.correct',
        targetType: 'user',
        targetId: dto.targetUserId,
        metadata: {
          amount: dto.amount,
          reasonType: dto.reasonType,
          reasonNotes: dto.reasonNotes ?? null,
          walletTxId: tx.id,
          capRemainingAfter: statusAfter.remaining,
          severity: 'high',
        },
        ...extractRequestContext(req),
      });

      return { transaction: tx, status: statusAfter };
    } catch (err) {
      if (err instanceof NoCorrectionCapError) {
        throw new ForbiddenException({
          message: err.message,
          error: 'NO_CAP_CONFIGURED',
        });
      }
      if (err instanceof CorrectionCapExceededError) {
        throw new ConflictException({
          message: err.message,
          error: 'EMPLOYEE_CAP_EXCEEDED',
          cap: err.cap,
          used: err.used,
          remaining: err.remaining,
          requested: err.requested,
        });
      }
      if (err instanceof InvalidCorrectionTargetError) {
        throw new BadRequestException({
          message: err.message,
          error: 'INVALID_CORRECTION_TARGET',
        });
      }
      throw err;
    }
  }

  /**
   * GET /tenant/correction/employees — lista de empleados con cupo > 0 +
   * consumo y restante del mes UTC. Para el panel admin de tesorería.
   * Permiso users.edit (mismo que fija cupos).
   */
  @Get('employees')
  @RequirePermissions('users.edit')
  async employees(@Req() req: RequestWithTenantContext) {
    const db = requireDb(req);
    const employees = await this.service.listEmployeesWithCap(db);
    return { employees };
  }

  /**
   * PATCH /tenant/correction/user/:userId/cap — admin (o quien tenga
   * users.edit) fija el cupo mensual de un empleado.
   */
  @Patch('user/:userId/cap')
  @RequirePermissions('users.edit')
  @HttpCode(HttpStatus.OK)
  async setCap(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetCorrectionCapDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = requireDb(req);

    // Validar que el usuario exista.
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        currentCap: users.employeeCorrectionCapMonthly,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const target = rows[0];
    if (!target) {
      throw new NotFoundException({ error: 'USER_NOT_FOUND' });
    }

    const beforeCap = target.currentCap;

    await db
      .update(users)
      .set({ employeeCorrectionCapMonthly: dto.cap, updatedAt: new Date() })
      .where(eq(users.id, userId));

    // Auditar solo si cambió (evita ruido).
    if (beforeCap !== dto.cap) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'employee.set_correction_cap',
        targetType: 'user',
        targetId: userId,
        metadata: {
          username: target.username,
          before: beforeCap,
          after: dto.cap,
          severity: 'medium',
        },
        ...extractRequestContext(req),
      });
    }

    return { userId, cap: dto.cap };
  }
}
