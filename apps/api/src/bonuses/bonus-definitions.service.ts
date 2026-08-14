/**
 * BonusDefinitionsService — CRUD de plantillas de bono.
 *
 * Resolución del funder (`funded_by_user_id`): al crear una definition,
 * el funder = el creador (regla §0 del doc). En sprints futuros se
 * extenderá para casos especiales (regla automática → último editor;
 * empleado del socio → el socio).
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getTableColumns } from 'drizzle-orm';
import {
  bonusDefinitions,
  roles,
  userRoles,
  users,
  type BonusDefinition,
  type NewBonusDefinition,
} from '@casino/db';
import { ActorRoleService } from '../common/actor-role.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { isUniqueViolation } from '../common/pg-error';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  BonusActorRoleError,
  BonusDefinitionCodeConflictError,
  BonusDefinitionNotFoundError,
} from './bonuses.errors';
import type {
  CreateBonusDefinitionDto,
  UpdateBonusDefinitionDto,
} from './dto/bonus-definition.dto';

/**
 * BonusDefinition + usernames legibles del funder/creador para los exports
 * CSV. Los campos van de forma ADITIVA sobre la fila normal del listado
 * (el panel los ignora, el CSV los usa).
 */
export interface BonusDefinitionWithActors extends BonusDefinition {
  fundedByUsername: string | null;
  createdByUsername: string | null;
}

@Injectable()
export class BonusDefinitionsService {
  constructor(
    private readonly actorRole: ActorRoleService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  async create(
    db: TenantDb,
    actorUserId: string,
    dto: CreateBonusDefinitionDto,
  ): Promise<BonusDefinition> {
    const actor = await this.actorRole.classify(db, actorUserId);
    if (actor.kind !== 'admin_tenant' && actor.kind !== 'independent_socio') {
      throw new BonusActorRoleError(actorUserId);
    }

    const values: NewBonusDefinition = {
      code: dto.code,
      name: dto.name,
      type: dto.type,
      status: dto.status ?? 'draft',
      config: dto.config ?? {},
      wagering: dto.wagering ?? {},
      expirationDays: dto.expirationDays ?? 30,
      segmentFilter: dto.segmentFilter ?? {},
      visibility: dto.visibility ?? {},
      fundedByUserId: actorUserId,
      createdByUserId: actorUserId,
    };

    try {
      const inserted = await db.insert(bonusDefinitions).values(values).returning();
      return inserted[0]!;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new BonusDefinitionCodeConflictError(dto.code);
      }
      throw err;
    }
  }

  async findById(db: TenantDb, id: string): Promise<BonusDefinition> {
    const rows = await db
      .select()
      .from(bonusDefinitions)
      .where(eq(bonusDefinitions.id, id))
      .limit(1);
    if (!rows[0]) throw new BonusDefinitionNotFoundError(id);
    return rows[0];
  }

  /**
   * Permite ver (read-only) una definition. Usado por GET :id.
   * - admin_tenant: ve todo.
   * - independent_socio: ve cualquiera (las suyas + las del admin).
   * - otros bajo sub-árbol indep: ven las de su branch-owner + las del admin.
   * - otros fuera de sub-árbol indep: ven solo las del admin.
   */
  async assertOwnerCanView(
    db: TenantDb,
    def: BonusDefinition,
    actorUserId: string,
  ): Promise<void> {
    const actor = await this.actorRole.classify(db, actorUserId);
    if (actor.kind === 'admin_tenant') return;
    if (actor.kind === 'independent_socio') return;
    // Otros: definitions del admin O del branch-owner (si están bajo indep)
    const adminIds = await this.getAdminTenantUserIds(db);
    if (adminIds.includes(def.createdByUserId)) return;
    const branchOwner = await this.hierarchy.getIndependentBranchAncestor(db, actorUserId);
    if (branchOwner && def.createdByUserId === branchOwner) return;
    throw new BonusDefinitionNotFoundError(def.id);
  }

  /**
   * Permite editar una definition. Usado por PATCH :id.
   * - admin_tenant: edita cualquiera.
   * - independent_socio: solo las suyas (createdByUserId === actor.id).
   * - otros: nunca (el role check en update() ya los bloquea antes).
   */
  async assertOwnerCanEdit(
    db: TenantDb,
    def: BonusDefinition,
    actorUserId: string,
  ): Promise<void> {
    const actor = await this.actorRole.classify(db, actorUserId);
    if (actor.kind === 'admin_tenant') return;
    if (actor.kind === 'independent_socio') {
      if (def.createdByUserId !== actorUserId) {
        throw new BonusDefinitionNotFoundError(def.id);
      }
      return;
    }
    throw new BonusDefinitionNotFoundError(def.id);
  }

  async findByCode(
    db: TenantDb,
    code: string,
    ownerUserId?: string,
  ): Promise<BonusDefinition | null> {
    // Capa 3 · Fase 1: el UNIQUE ahora es (code, created_by_user_id).
    // Sin ownerUserId, un mismo code puede existir en varios owners; el
    // caller elige explícitamente en qué owner buscar. Sin filtro
    // devuelve el primer match arbitrario (compat con auto-grant tenant).
    const conditions = [eq(bonusDefinitions.code, code)];
    if (ownerUserId) {
      conditions.push(eq(bonusDefinitions.createdByUserId, ownerUserId));
    }
    const rows = await db
      .select()
      .from(bonusDefinitions)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(
    db: TenantDb,
    filters: {
      status?: string;
      type?: string;
      /** Sprint 51.2: filtrar por owner (created_by_user_id). Usado por:
       *  - socio independent: pasa su propio id para ver solo las suyas.
       *  - listado read-only del socio: tenant-wide (ownerIds=[admin]).
       */
      ownerUserIds?: string[];
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ data: BonusDefinitionWithActors[]; total: number }> {
    const conditions = [];
    if (filters.status) conditions.push(eq(bonusDefinitions.status, filters.status as 'active'));
    if (filters.type) conditions.push(eq(bonusDefinitions.type, filters.type as 'welcome'));
    if (filters.ownerUserIds && filters.ownerUserIds.length > 0) {
      conditions.push(inArray(bonusDefinitions.createdByUserId, filters.ownerUserIds));
    }

    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Self-joins a `users` para los usernames de funder/creador (exports CSV).
    const funder = alias(users, 'funder_user');
    const creator = alias(users, 'creator_user');
    const rows = await db
      .select({
        ...getTableColumns(bonusDefinitions),
        fundedByUsername: funder.username,
        createdByUsername: creator.username,
      })
      .from(bonusDefinitions)
      .leftJoin(funder, eq(funder.id, bonusDefinitions.fundedByUserId))
      .leftJoin(creator, eq(creator.id, bonusDefinitions.createdByUserId))
      .where(whereExpr)
      .orderBy(desc(bonusDefinitions.createdAt))
      .limit(limit)
      .offset(offset);
    const data: BonusDefinitionWithActors[] = rows;

    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bonusDefinitions)
      .where(whereExpr);
    const total = totalResult[0]?.count ?? 0;

    return { data, total };
  }

  /**
   * Sprint 51.3: lista ids de users con rol admin_tenant. Usado por el
   * controller para resolver `?ownerScope=tenant` — el socio independent
   * pide "ver las del tenant" sin necesidad de saber qué ids tiene.
   */
  async getAdminTenantUserIds(db: TenantDb): Promise<string[]> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(roles.code, 'admin_tenant'));
    return rows.map((r) => r.id);
  }

  async update(
    db: TenantDb,
    id: string,
    dto: UpdateBonusDefinitionDto,
    actorUserId: string,
  ): Promise<BonusDefinition> {
    const actor = await this.actorRole.classify(db, actorUserId);
    if (actor.kind !== 'admin_tenant' && actor.kind !== 'independent_socio') {
      throw new BonusActorRoleError(actorUserId);
    }
    const existing = await this.findById(db, id);
    await this.assertOwnerCanEdit(db, existing, actorUserId);

    const patch: Partial<NewBonusDefinition> = {
      updatedAt: new Date(),
    };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.config !== undefined) patch.config = dto.config;
    if (dto.wagering !== undefined) patch.wagering = dto.wagering;
    if (dto.expirationDays !== undefined) patch.expirationDays = dto.expirationDays;
    if (dto.segmentFilter !== undefined) patch.segmentFilter = dto.segmentFilter;
    if (dto.visibility !== undefined) patch.visibility = dto.visibility;

    const updated = await db
      .update(bonusDefinitions)
      .set(patch)
      .where(eq(bonusDefinitions.id, id))
      .returning();
    return updated[0]!;
  }
}
