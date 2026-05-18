/**
 * PaymentMethodsController — endpoint user-facing del catálogo del tenant.
 *
 * Endpoint:
 *   GET /tenant/payment-methods?activeOnly=true (default true)
 *
 * **NO** requiere permission — cualquier user logueado del tenant puede
 * ver qué métodos de pago acepta. Es info pública del operador (igual que
 * el listado de juegos disponibles). El admin la setea via SQL/seed en MVP.
 *
 * Para acciones admin (crear/editar/desactivar métodos) sumar sprint futuro
 * cuando emerja necesidad.
 */

import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { PaymentMethodsService } from './payment-methods.service';

@Controller('tenant/payment-methods')
@UseGuards(TenantJwtGuard)
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

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
}
