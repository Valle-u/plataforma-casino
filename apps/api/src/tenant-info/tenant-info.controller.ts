/**
 * TenantInfoController — endpoint de demo del TenantContext.
 *
 * Muestra que el TenantResolverMiddleware funciona correctamente: el endpoint
 * lee el `tenantContext` del request y devuelve info básica + un check vivo
 * a la DB del tenant.
 *
 * Sin auth (público) para facilitar testing. En producción este tipo de
 * endpoints normalmente requeriría auth de jugador o cajero.
 *
 * Ejemplo de uso:
 *   curl -H "Host: demo.localhost" http://localhost:3000/tenant/info
 */

import { Controller, Get, NotFoundException, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';

@Controller('tenant')
export class TenantInfoController {
  /**
   * GET /tenant/info
   * Devuelve info del tenant resuelto + ping a su DB.
   */
  @Get('info')
  async getInfo(@Req() req: RequestWithTenantContext): Promise<unknown> {
    if (!req.tenantContext) {
      throw new NotFoundException(
        'No se encontró tenant para este Host. Verificá tenant_domains en la DB de control.',
      );
    }

    const { tenant, db } = req.tenantContext;

    // Ping vivo: ejecutamos una query trivial contra la DB del tenant.
    // Confirma que la conexión está abierta y la DB existe.
    const pingResult = await db.execute(
      sql`SELECT current_database() AS db_name, now() AS db_now`,
    );
    const ping = pingResult[0] as
      | { db_name: string; db_now: Date }
      | undefined;

    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        planId: tenant.planId,
      },
      tenantDb: {
        connectedTo: ping?.db_name ?? null,
        currentTime: ping?.db_now ?? null,
      },
      message: '✅ Tenant resuelto correctamente desde Host header.',
    };
  }
}
