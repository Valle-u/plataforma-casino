/**
 * TenantsService — operaciones sobre la tabla `tenants` del control DB.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import {
  deriveAdminUrl,
  provisionTenantDatabase,
  tenantDomains,
  tenantPlans,
  tenants,
  type ControlDb,
  type Tenant,
} from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import type { CreateTenantDto } from './dto/create-tenant.dto';

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
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @Inject(CONTROL_DB) private readonly db: ControlDb,
    private readonly config: ConfigService,
  ) {}

  /**
   * Lista todos los tenants no soft-deleted con info de plan resumida.
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

  /**
   * Crea un tenant nuevo + provisiona su DB Postgres.
   *
   * Pasos:
   *   1. Valida que el plan exista (planCode).
   *   2. Calcula dbName = "tenant_" + slug (con guiones a underscores).
   *   3. Valida que el slug, dbName y primaryDomain no existan ya.
   *   4. Inserta tenant con status='onboarding'.
   *   5. Inserta primary domain.
   *   6. Provisiona la DB Postgres (CREATE DATABASE).
   *   7. Marca tenant como status='active'.
   *
   * Si el paso 6 falla, el tenant queda en 'onboarding' (revisar manualmente
   * o reintentar). Para MVP no hay rollback automático.
   */
  async create(dto: CreateTenantDto, actorEmail: string): Promise<Tenant> {
    // 1. Plan existe?
    const planRows = await this.db
      .select()
      .from(tenantPlans)
      .where(eq(tenantPlans.code, dto.planCode))
      .limit(1);
    const plan = planRows[0];
    if (!plan) {
      throw new BadRequestException(`Plan "${dto.planCode}" no existe.`);
    }

    // 2. dbName desde slug
    const dbName = `tenant_${dto.slug.replace(/-/g, '_')}`;

    // 3. Uniqueness checks (DB unique constraints también lo enforce, pero
    //    queremos errores 409 amigables, no 500 con detalles de SQL).
    const slugExists = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, dto.slug))
      .limit(1);
    if (slugExists.length > 0) {
      throw new ConflictException(`Slug "${dto.slug}" ya está en uso.`);
    }

    const domainExists = await this.db
      .select({ id: tenantDomains.id })
      .from(tenantDomains)
      .where(eq(tenantDomains.domain, dto.primaryDomain.toLowerCase()))
      .limit(1);
    if (domainExists.length > 0) {
      throw new ConflictException(`Dominio "${dto.primaryDomain}" ya está en uso.`);
    }

    // 4. Inserta tenant en onboarding
    const [created] = await this.db
      .insert(tenants)
      .values({
        slug: dto.slug,
        name: dto.name,
        dbName,
        dbHost: 'localhost', // MVP — todos los tenants comparten host
        status: 'onboarding',
        planId: plan.id,
        contactEmail: dto.contactEmail,
      })
      .returning();

    if (!created) {
      throw new Error('Falló inserción de tenant — esto no debería pasar.');
    }

    this.logger.log(
      `Tenant ${created.slug} (id=${created.id}) creado en onboarding por ${actorEmail}`,
    );

    // 5. Inserta primary domain
    await this.db.insert(tenantDomains).values({
      tenantId: created.id,
      domain: dto.primaryDomain.toLowerCase(),
      isPrimary: true,
    });

    // 6. Provisiona DB Postgres
    const controlUrl = this.config.get<string>('DATABASE_URL_CONTROL');
    if (!controlUrl) {
      throw new Error('DATABASE_URL_CONTROL no configurada.');
    }
    const adminUrl = deriveAdminUrl(controlUrl);

    const provResult = await provisionTenantDatabase(adminUrl, dbName);
    this.logger.log(
      `Tenant ${created.slug}: DB Postgres ${provResult.created ? 'creada' : 'ya existía'} (${dbName})`,
    );

    // 7. Marcar como active
    const [activated] = await this.db
      .update(tenants)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(tenants.id, created.id))
      .returning();

    if (!activated) {
      throw new Error('Falló transición a active.');
    }

    this.logger.log(`Tenant ${activated.slug} listo (active).`);
    return activated;
  }
}
