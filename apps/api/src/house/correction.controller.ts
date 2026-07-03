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
import { and, eq } from 'drizzle-orm';
import { roles, userRoles, users } from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { AdminNetworkBypass } from '../user-hierarchy/admin-network-bypass.decorator';
import { ScopeTarget } from '../user-hierarchy/scope-target.decorator';
import { ScopeGuard } from '../user-hierarchy/scope.guard';
import { WalletCorrectDto } from '../wallet/dto/correction.dto';
import { SetCorrectionCapDto } from '../wallet/dto/set-correction-cap.dto';
import {
  CorrectionCapExceededError,
  EmployeeCorrectionService,
  InvalidCorrectionTargetError,
  NoCorrectionCapError,
} from '../wallet/employee-correction.service';
import { InsufficientBalanceError } from '../wallet/wallet.errors';

function requireDb(req: RequestWithTenantContext) {
  if (!req.tenantContext) throw new Error('TenantContext no resuelto.');
  return req.tenantContext.db;
}

@Controller('tenant/correction')
@UseGuards(TenantJwtGuard, PermissionsGuard, ScopeGuard)
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
  @ScopeTarget('targetUserId', 'body')
  @AdminNetworkBypass('wallet.correct_admin_network')
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
      // Insufficient balance en la Casa → 409 legible (antes: 500).
      // Ocurre si la Casa no fue fondeada con inject-budget o
      // inject-capital.
      if (err instanceof InsufficientBalanceError) {
        throw new ConflictException({
          message: 'La Casa no tiene fondos suficientes. Fondeala con inject-capital o inject-budget antes de operar correcciones.',
          error: 'HOUSE_INSUFFICIENT_BALANCE',
          available: err.available,
          required: err.required,
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
   * GET /tenant/correction/user/:userId/cap — cupo configurado + consumo del
   * mes de un empleado específico. Para pre-cargar el modal de edición desde
   * el detalle del usuario. Permiso users.edit (mismo que el PATCH).
   */
  @Get('user/:userId/cap')
  @RequirePermissions('users.edit')
  async getUserCap(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = requireDb(req);
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const target = rows[0];
    if (!target) {
      throw new NotFoundException({ error: 'USER_NOT_FOUND' });
    }
    const status = await this.service.getStatus(db, userId);
    return {
      userId,
      username: target.username,
      displayName: target.displayName,
      cap: status.cap,
      used: status.used,
      remaining: status.remaining,
    };
  }

  /**
   * PATCH /tenant/correction/user/:userId/cap — admin (o quien tenga
   * users.edit) fija el cupo mensual de un empleado.
   *
   * Seguridad (D1): sin @ScopeTarget, un socio independiente con `users.edit`
   * (auto-grant de INDEPENDENT_BRANCH_AUTO_PERMISSIONS) podía subirle el cupo
   * a un empleado de la red del admin y drenar la Casa vía correcciones. El
   * ScopeGuard ahora restringe el target a la sub-red del actor, con bypass
   * admin_network para el comodín del admin (mismo patrón que F4).
   */
  @Patch('user/:userId/cap')
  @RequirePermissions('users.edit')
  @ScopeTarget('userId', 'param')
  @AdminNetworkBypass('house.set_employee_cap_admin_network')
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

    // Solo se puede FIJAR/AUMENTAR cupo a users con rol 'empleado'. Reset a 0
    // (cleanup) siempre está permitido, aún si el user perdió el rol — así se
    // pueden limpiar cupos legacy o de ex-empleados sin bloqueo.
    if (Number(dto.cap) > 0) {
      const roleRows = await db
        .select({ code: roles.code })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(eq(userRoles.userId, userId), eq(roles.code, 'empleado')))
        .limit(1);
      if (!roleRows[0]) {
        throw new BadRequestException({
          error: 'TARGET_NOT_EMPLOYEE',
          message:
            'El cupo de correcciones solo puede asignarse a usuarios con rol empleado.',
        });
      }
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
