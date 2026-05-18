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
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import {
  promotions,
  type NewPromotion,
  type Promotion,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  PromotionCodeConflictError,
  PromotionNotFoundError,
} from './promotions.errors';
import type {
  CreatePromotionDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';

@Injectable()
export class PromotionsService {
  async create(
    db: TenantDb,
    actorUserId: string,
    dto: CreatePromotionDto,
  ): Promise<Promotion> {
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
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
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
  ): Promise<{ data: Promotion[]; total: number }> {
    const conditions = [];
    if (filters.type)
      conditions.push(eq(promotions.type, filters.type as Promotion['type']));
    if (filters.status)
      conditions.push(eq(promotions.status, filters.status as Promotion['status']));
    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const data = await db
      .select()
      .from(promotions)
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
   * Listing player-facing: solo promociones `status='active'` y dentro de su
   * ventana (`startsAt..endsAt`). Sin permission especial — cualquier user
   * logueado puede descubrir qué promos tiene disponibles.
   *
   * Filtro opcional por `type` (e.g. 'daily_wheel') para que el frontend
   * traiga solo lo que va a renderizar. Cap a 50 — un tenant no debería
   * tener más de un puñado de promos activas simultáneas.
   *
   * NOTE: targeting/visibility por segmento se evalúa cuando el player
   * interactúa (spin/claim) — acá devolvemos TODAS las activas. Si emerge
   * necesidad de filtrar por audience en el listing, sumar acá un join
   * con user_segments.
   */
  async listActiveForPlayer(
    db: TenantDb,
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

    return db
      .select()
      .from(promotions)
      .where(and(...conditions))
      .orderBy(asc(promotions.createdAt))
      .limit(50);
  }

  async update(
    db: TenantDb,
    id: string,
    dto: UpdatePromotionDto,
  ): Promise<Promotion> {
    await this.findById(db, id); // 404 si no existe

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
