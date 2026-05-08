/**
 * TenantsService — lógica de negocio relacionada a tenants.
 *
 * Por ahora solo expone `findAll()`. A medida que crezca, vamos a sumar:
 *   - findById, findBySlug, findByDomain (para TenantResolver)
 *   - create / suspend / restore (con job de provisioning de DB)
 *   - update plan, etc.
 */

import { Inject, Injectable } from '@nestjs/common';
import { CONTROL_DB } from '../database/database.module';
import type { ControlDb } from '@casino/db';
import { tenants, tenantPlans } from '@casino/db';
import { eq } from 'drizzle-orm';

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  contactEmail: string;
  planCode: string | null;
  createdAt: Date;
}

@Injectable()
export class TenantsService {
  constructor(@Inject(CONTROL_DB) private readonly db: ControlDb) {}

  /**
   * Lista todos los tenants con info resumida.
   * Hace LEFT JOIN con tenant_plans para incluir el código del plan.
   * Excluye tenants soft-deleted (deleted_at IS NOT NULL).
   */
  async findAll(): Promise<TenantSummary[]> {
    const rows = await this.db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        contactEmail: tenants.contactEmail,
        planCode: tenantPlans.code,
        createdAt: tenants.createdAt,
        deletedAt: tenants.deletedAt,
      })
      .from(tenants)
      .leftJoin(tenantPlans, eq(tenants.planId, tenantPlans.id));

    return rows
      .filter((row) => row.deletedAt === null)
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        contactEmail: row.contactEmail,
        planCode: row.planCode,
        createdAt: row.createdAt,
      }));
  }
}
