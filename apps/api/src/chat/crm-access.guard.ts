/**
 * CrmAccessGuard — autoriza el acceso al CRM/soporte por RED.
 *
 * Deja pasar al staff central (admin + empleados) y a la red independiente;
 * BLOQUEA (403) a los operadores de la red dependiente. Además resuelve la
 * "bandeja" del operador (`crmInboxOwnerId`) y la adjunta al request, para que
 * los handlers autoricen contra el dueño correcto (el admin principal para el
 * staff central, o el propio operador para la red independiente).
 *
 * Corre DESPUÉS de TenantJwtGuard (que puebla `tenantUser` + `tenantContext`).
 */

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { RequestWithTenantUser } from '../tenant-auth/guards/tenant-jwt.guard';
import { CrmNetworkService } from './crm-network.service';

/** El request con la bandeja del operador resuelta por el guard. */
export type RequestWithCrmInbox = RequestWithTenantUser & {
  crmInboxOwnerId?: string;
};

@Injectable()
export class CrmAccessGuard implements CanActivate {
  constructor(private readonly net: CrmNetworkService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<RequestWithCrmInbox>();
    const db = req.tenantContext?.db;
    if (!db) throw new NotFoundException('Tenant no resuelto.');
    const userId = req.tenantUser?.id;
    if (!userId) throw new ForbiddenException('No tenés acceso al soporte.');

    const owner = await this.net.resolveInboxOwner(db, userId);
    if (!owner) {
      throw new ForbiddenException('No tenés acceso al soporte.');
    }
    req.crmInboxOwnerId = owner;
    return true;
  }
}
