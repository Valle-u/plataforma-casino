/**
 * PromotionsService — CRUD genérico de promociones.
 *
 * Funder = creador. Igual pattern que bonus_definitions (resuelto al crear,
 * NUNCA cambia).
 *
 * Validación type-specific (e.g. probabilidades del wheel) la hacen los
 * services de cada type (DailyWheelService, etc.) — este service solo
 * persiste lo que llega.
 */

import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  promotionRewards,
  promotions,
  users,
  type NewPromotion,
  type Promotion,
  type PromotionReward,
} from '@casino/db';
import { ActorRoleService } from '../common/actor-role.service';
import { isUniqueViolation } from '../common/pg-error';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  PromotionActorRoleError,
  PromotionCodeConflictError,
  PromotionNotFoundError,
} from './promotions.errors';
import { parseWheelConfig } from './wheel-config';
import { WheelEligibilityService } from './wheel-eligibility.service';
import type {
  CreatePromotionDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';

/**
 * Reward enriquecido con datos del beneficiario para display en el panel
 * admin (mismo patrón que `commission_payouts` con beneficiary username).
 */
export interface PromotionRewardWithUser extends PromotionReward {
  userUsername: string | null;
  userDisplayName: string | null;
}

/**
 * Promotion del listado + usernames legibles del funder/creador para los
 * exports CSV (aditivos; el panel los ignora).
 */
export interface PromotionWithActors extends Promotion {
  fundedByUsername: string | null;
  createdByUsername: string | null;
}

export interface ListRewardsFilters {
  /** Filtrar por un beneficiario específico. */
  userId?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class PromotionsService {
  constructor(
    private readonly actorRole: ActorRoleService,
    private readonly wheelEligibility: WheelEligibilityService,
  ) {}

  async create(
    db: TenantDb,
    actorUserId: string,
    dto: CreatePromotionDto,
  ): Promise<Promotion> {
    // Sprint 51.2: gate de rol — promotions son "servicio plataforma".
    // Solo admin_tenant crea, su wallet paga los premios (funder=actor).
    //
    // ⚠️ Acá decía "aplica a TODOS los players, incluso bajo socios
    // independent". **Ya no.** Desde el 2026-09-10, la ruleta diaria excluye a
    // los jugadores de sub-redes independientes: los premios los paga la Casa y
    // fondear una red independiente viola la LEY **E8**. El filtro vive en
    // `WheelEligibilityService`. Los demás tipos de promo siguen sin acotar —
    // cuando se les agregue premio real habrá que hacerles la misma pregunta.
    const isAdmin = await this.actorRole.isAdminTenant(db, actorUserId);
    if (!isAdmin) {
      throw new PromotionActorRoleError(actorUserId);
    }

    if (dto.type === 'daily_wheel') {
      parseWheelConfig(dto.config ?? {});
    }

    const values: NewPromotion = {
      code: dto.code,
      name: dto.name,
      type: dto.type,
      status: dto.status ?? 'draft',
      config: dto.config ?? {},
      prizes: dto.prizes ?? {},
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      drawAt: dto.drawAt ? new Date(dto.drawAt) : null,
      targetSegment: dto.targetSegment ?? {},
      visibility: dto.visibility ?? {},
      fundedByUserId: actorUserId,
      createdByUserId: actorUserId,
    };

    try {
      const inserted = await db.insert(promotions).values(values).returning();
      return inserted[0]!;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new PromotionCodeConflictError(dto.code);
      }
      throw err;
    }
  }

  async findById(db: TenantDb, id: string): Promise<Promotion> {
    const rows = await db
      .select()
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);
    if (!rows[0]) throw new PromotionNotFoundError(id);
    return rows[0];
  }

  async list(
    db: TenantDb,
    filters: { type?: string; status?: string; limit?: number; offset?: number } = {},
  ): Promise<{ data: PromotionWithActors[]; total: number }> {
    const conditions = [];
    if (filters.type)
      conditions.push(eq(promotions.type, filters.type as Promotion['type']));
    if (filters.status)
      conditions.push(eq(promotions.status, filters.status as Promotion['status']));
    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Self-joins a `users` para los usernames de funder/creador (exports CSV).
    const funder = alias(users, 'funder_user');
    const creator = alias(users, 'creator_user');
    const data: PromotionWithActors[] = await db
      .select({
        ...getTableColumns(promotions),
        fundedByUsername: funder.username,
        createdByUsername: creator.username,
      })
      .from(promotions)
      .leftJoin(funder, eq(funder.id, promotions.fundedByUserId))
      .leftJoin(creator, eq(creator.id, promotions.createdByUserId))
      .where(whereExpr)
      .orderBy(desc(promotions.createdAt))
      .limit(limit)
      .offset(offset);

    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(promotions)
      .where(whereExpr);
    return { data, total: totalResult[0]?.count ?? 0 };
  }

  /**
   * Las promos activas que este jugador puede ver: `status='active'` y dentro
   * de su ventana (`startsAt..endsAt`). Sin permission especial — cualquier
   * user logueado descubre acá qué tiene disponible.
   *
   * Filtro opcional por `type` (e.g. 'daily_wheel') para que el frontend
   * traiga solo lo que va a renderizar. Cap a 50 — un tenant no debería
   * tener más de un puñado de promos activas simultáneas.
   *
   * ⚠️ **`viewerUserId` no es un parámetro de comodidad.** Hasta el 2026-09-10
   * este método no recibía al jugador y no filtraba nada: devolvía todas las
   * promos activas del casino a cualquiera, incluidos los jugadores de
   * sub-redes independientes, a los que la ruleta les llegaba **pagada por la
   * Casa** (LEY **E8**). El filtro de elegibilidad es el mismo del giro —
   * `WheelEligibilityService`— para que la pantalla y el endpoint no puedan
   * decir cosas distintas.
   *
   * Sólo se filtra `daily_wheel`, que es el tipo cuyas reglas están definidas
   * (`docs/27-ruleta-diaria.md`). Los otros tipos pasan como antes: el día que
   * tengan premio real hay que hacerles la misma pregunta.
   *
   * NOTE: targeting/visibility por segmento se evalúa cuando el player
   * interactúa (spin/claim). Si emerge necesidad de filtrar por audience en el
   * listing, sumar acá un join con user_segments.
   */
  async listActiveForPlayer(
    db: TenantDb,
    viewerUserId: string,
    filters: { type?: string } = {},
  ): Promise<Promotion[]> {
    const now = new Date();
    const conditions = [eq(promotions.status, 'active')];
    if (filters.type) {
      conditions.push(eq(promotions.type, filters.type as Promotion['type']));
    }
    // startsAt es null O <= now.
    conditions.push(
      or(isNull(promotions.startsAt), lte(promotions.startsAt, now))!,
    );
    // endsAt es null O >= now.
    conditions.push(
      or(isNull(promotions.endsAt), gte(promotions.endsAt, now))!,
    );

    const activas = await db
      .select()
      .from(promotions)
      .where(and(...conditions))
      .orderBy(asc(promotions.createdAt))
      .limit(50);

    // La elegibilidad no depende de la promo sino del jugador, así que se
    // resuelve UNA vez y no una por ruleta. Y sólo si hay alguna ruleta: para
    // un casino sin ruleta activa, esto no cuesta nada.
    if (!activas.some((p) => p.type === 'daily_wheel')) return activas;

    const puedeGirar = await this.wheelEligibility.canSpin(db, viewerUserId);
    if (puedeGirar) return activas;
    return activas.filter((p) => p.type !== 'daily_wheel');
  }

  /**
   * Listing admin: todos los rewards entregados para una promotion, enriquecidos
   * con username/displayName del beneficiario. Sirve tanto para `daily_wheel`
   * (spins) como para `login_streak` (claims) y futuras promos (missions,
   * lottery) — todas escriben en `promotion_rewards`.
   *
   * Orden DESC por `granted_at` (más reciente primero — lo que el admin
   * querrá ver en el panel). Cap 200 por request (paginar con offset).
   *
   * Sin scope downstream: el admin con `promotions.view` ve todos los
   * rewards del tenant. Si emerge necesidad de scope (cajero ve solo los
   * de sus clientes), sumar `userIds?: string[]` filter — mismo pattern
   * que deposits/withdrawals (Sprint 23).
   */
  async listRewardsForPromotion(
    db: TenantDb,
    promotionId: string,
    filters: ListRewardsFilters = {},
  ): Promise<{ data: PromotionRewardWithUser[]; total: number }> {
    const conditions = [eq(promotionRewards.promotionId, promotionId)];
    if (filters.userId) {
      conditions.push(eq(promotionRewards.userId, filters.userId));
    }
    const where = and(...conditions);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const rows = await db
      .select({
        reward: promotionRewards,
        userUsername: users.username,
        userDisplayName: users.displayName,
      })
      .from(promotionRewards)
      .leftJoin(users, eq(users.id, promotionRewards.userId))
      .where(where)
      .orderBy(desc(promotionRewards.grantedAt), desc(promotionRewards.id))
      .limit(limit)
      .offset(offset);

    const data: PromotionRewardWithUser[] = rows.map((r) => ({
      ...r.reward,
      userUsername: r.userUsername,
      userDisplayName: r.userDisplayName,
    }));

    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(promotionRewards)
      .where(where);
    return { data, total: totalRows[0]?.n ?? 0 };
  }

  async update(
    db: TenantDb,
    id: string,
    dto: UpdatePromotionDto,
    actorUserId?: string,
  ): Promise<Promotion> {
    const actual = await this.findById(db, id); // 404 si no existe

    // Sprint 51.2: si nos pasan actor, validar que es admin_tenant.
    // El controller llama con actor — la firma optional mantiene compat
    // con tests u otros callers internos legacy.
    if (actorUserId !== undefined) {
      const isAdmin = await this.actorRole.isAdminTenant(db, actorUserId);
      if (!isAdmin) {
        throw new PromotionActorRoleError(actorUserId);
      }
    }

    // La config de una ruleta se valida al GUARDAR, no sólo al girar. Antes
    // sólo se validaba al girar: una config rota se guardaba sin chistar y
    // explotaba en la cara del primer jugador.
    if (dto.config !== undefined && actual.type === 'daily_wheel') {
      parseWheelConfig(dto.config);
    }

    const patch: Partial<NewPromotion> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.config !== undefined) patch.config = dto.config;
    if (dto.prizes !== undefined) patch.prizes = dto.prizes;
    if (dto.startsAt !== undefined) patch.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.endsAt !== undefined) patch.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.drawAt !== undefined) patch.drawAt = dto.drawAt ? new Date(dto.drawAt) : null;
    if (dto.targetSegment !== undefined) patch.targetSegment = dto.targetSegment;
    if (dto.visibility !== undefined) patch.visibility = dto.visibility;

    const updated = await db
      .update(promotions)
      .set(patch)
      .where(eq(promotions.id, id))
      .returning();
    return updated[0]!;
  }
}
