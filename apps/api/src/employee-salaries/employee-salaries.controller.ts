/**
 * EmployeeSalariesController — sueldos por empleado.
 *
 * F1 · Sueldos por empleado en socios dependientes. El admin fija un sueldo
 * mensual por cada empleado que un socio dep creó; el motor de comisiones
 * (F1) descuenta este monto del NetWin del socio dep dueño de la rama del
 * empleado al momento del settle.
 *
 * Acceso: **admin_tenant only**. Los sueldos son data sensible del negocio
 * y decisión exclusiva del admin — no se delega. El guard `PermissionsGuard`
 * no basta: el rol admin_tenant se valida explícitamente en cada handler.
 *
 * Endpoints:
 *   - `PUT /tenant/employees/:userId/salary`   → setear sueldo (upsert).
 *   - `GET /tenant/employees/:userId/salary`   → consultar sueldo del user.
 *   - `GET /tenant/employees/salaries`         → lista paginada.
 *
 * Todos con `TenantJwtGuard + PanelOnly`. El chequeo de rol admin_tenant
 * está inline con `assertAdminTenant()` — más simple que un permiso nuevo
 * en el catálogo, y refleja la política "solo el admin decide sueldos".
 */

import {
  Body,
  Controller,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext, TenantDb } from '../tenant-resolver/tenant-context';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { SetEmployeeSalaryDto } from './dto/set-employee-salary.dto';
import { EmployeeSalariesService, type SalaryListRow } from './employee-salaries.service';

interface SalaryPublic {
  userId: string;
  monthlyAmount: string;
  currency: string;
  updatedAt: Date;
  updatedBy: string | null;
  notes: string | null;
}

@Controller('tenant/employees')
@UseGuards(TenantJwtGuard)
@PanelOnly()
export class EmployeeSalariesController {
  constructor(
    private readonly salaries: EmployeeSalariesService,
    private readonly tenantUsers: TenantUsersService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * PUT /tenant/employees/:userId/salary — upsert sueldo del empleado.
   *
   * Solo admin_tenant. Registra `employee_salaries.update` en audit_log
   * con severity=medium (cambia una decisión económica del negocio, pero
   * no mueve fichas hasta el próximo settle).
   *
   * Idempotente: setear el mismo monto/currency/notas no genera entry
   * de audit (only real changes).
   */
  @Put(':userId/salary')
  @HttpCode(HttpStatus.OK)
  async setSalary(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: SetEmployeeSalaryDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ salary: SalaryPublic; changed: boolean; updatedBy: string }> {
    const db = this.assertDb(req);
    await this.assertAdminTenant(db, actor.id);

    const { before, after, changed } = await this.salaries.upsert(db, {
      userId: targetUserId,
      monthlyAmount: dto.monthlyAmount,
      currency: dto.currency,
      notes: dto.notes ?? null,
      updatedBy: actor.id,
    });

    if (changed) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'employee_salaries.update',
        targetType: 'user',
        targetId: targetUserId,
        before: before ? this.snapshot(before) : null,
        after: this.snapshot(after),
        metadata: {
          severity: 'medium',
          monthlyAmount: after.monthlyAmount,
          currency: after.currency,
          isFirstSet: before === null,
        },
        ...extractRequestContext(req),
      });
    }

    return {
      salary: this.snapshot(after),
      changed,
      updatedBy: actor.username,
    };
  }

  /**
   * GET /tenant/employees/:userId/salary — consulta el sueldo del user.
   *
   * 404 si el user no tiene sueldo configurado (fila ausente). NO 404 si
   * tiene sueldo en 0 — devuelve la fila normal (0 es un valor válido).
   */
  @Get(':userId/salary')
  async getSalary(
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ): Promise<{ salary: SalaryPublic }> {
    const db = this.assertDb(req);
    await this.assertAdminTenant(db, actor.id);

    const row = await this.salaries.findByUserId(db, targetUserId);
    if (!row) {
      throw new NotFoundException(
        `El user ${targetUserId} no tiene sueldo configurado.`,
      );
    }

    return { salary: this.snapshot(row) };
  }

  /**
   * GET /tenant/employees/salaries — lista paginada de sueldos.
   *
   * ?limit=<n>         default 50, max 200.
   * ?offset=<n>        default 0.
   * ?hasSalary=<bool>  default true → solo los que cobran > 0. false → incluye
   *                    los que están en 0.
   *
   * Orden por `updated_at DESC`.
   */
  @Get('salaries')
  async list(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('hasSalary', new DefaultValuePipe(true), ParseBoolPipe)
    hasSalary: boolean,
  ): Promise<{ data: SalaryListRow[]; count: number; total: number }> {
    const db = this.assertDb(req);
    await this.assertAdminTenant(db, actor.id);

    const { data, total } = await this.salaries.list(db, {
      limit,
      offset,
      hasSalary,
    });

    return { data, count: data.length, total };
  }

  // ────────────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────────────

  private assertDb(req: RequestWithTenantContext): TenantDb {
    if (!req.tenantContext) {
      throw new Error('TenantContext faltante.');
    }
    return req.tenantContext.db;
  }

  /**
   * Chequea que el actor tenga rol admin_tenant. Los sueldos son decisión
   * exclusiva del admin. Sub-delegar esto rompería el modelo.
   */
  private async assertAdminTenant(
    db: TenantDb,
    actorId: string,
  ): Promise<void> {
    const roleCodes = (await this.tenantUsers.getRoles(db, actorId)).map(
      (r) => r.code,
    );
    if (!roleCodes.includes('admin_tenant')) {
      throw new ForbiddenException({
        message:
          'Solo el admin del tenant puede administrar sueldos de empleados.',
        error: 'ADMIN_TENANT_ONLY',
      });
    }
  }

  /** Shape público del sueldo (sin campos de auditoría redundantes). */
  private snapshot(row: {
    userId: string;
    monthlyAmount: string;
    currency: string;
    updatedAt: Date;
    updatedBy: string | null;
    notes: string | null;
  }): SalaryPublic {
    return {
      userId: row.userId,
      monthlyAmount: row.monthlyAmount,
      currency: row.currency,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      notes: row.notes,
    };
  }
}
