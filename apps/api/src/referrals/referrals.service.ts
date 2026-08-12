/**
 * ReferralsService — Fase 1+2 del sistema de links de referido.
 *
 * Responsabilidades:
 *   Fase 1:
 *     1. getOrCreateCode(userId) — fija referral_code = username (one-time).
 *     2. resolveCode(code) — lookup público: code → valid + displayName.
 *     3. trackClick(code, ip, ua, referer) — inserta click event.
 *     4. getMyStats(userId) — total clicks + signups del operador.
 *   Fase 2:
 *     5. resolveReferrerId(code) — lookup: code → referrer user ID + roles.
 *     6. createAttribution(params) — crea referral_attributions row.
 *
 * NO muta jerarquía directamente. El controller llama a UserHierarchyService
 * después de createAttribution para el auto-parent.
 *
 * Leyes aplicables: R5 (jugador), R3 (marketing), P1 (scope), P4 (multi-tenant).
 */

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import {
  deposits,
  referralAttributions,
  referralClickEvents,
  referralCodes,
  roles,
  userRoles,
  users,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export interface ReferralCodeInfo {
  /** null cuando el usuario no tiene código base (el admin: su base es el
   *  tráfico orgánico → Socio madre; no necesita un código personal). */
  code: string | null;
  link: string | null;
  generatedAt: Date | null;
}

/** Un código (base o campaña) con sus métricas agregadas. */
export interface ReferralCodeListItem {
  /** null = código base (username). uuid = campaña de referral_codes. */
  id: string | null;
  code: string;
  label: string;
  isActive: boolean;
  isBase: boolean;
  link: string;
  clicks: number;
  signups: number;
  /** Usuarios referidos por este código con ≥1 depósito aprobado (FTD). */
  ftds: number;
  createdAt: Date | null;
}

export interface MyReferralCodesResult {
  /** null para el admin (no tiene código base). */
  base: ReferralCodeListItem | null;
  campaigns: ReferralCodeListItem[];
  /** Tope de campañas ACTIVAS por usuario. */
  campaignCap: number;
}

export interface ReferralResolveResult {
  displayName: string;
  valid: boolean;
}

export interface ReferralMyStats {
  totalClicks: number;
  totalSignups: number;
}

export interface ReferrerInfo {
  id: string;
  roleCodes: string[];
  /** true = campaña de admin: se atribuye pero NO se auto-parentea (los
   *  jugadores del admin son root en la jerarquía, docs/03). */
  skipAutoParent: boolean;
}

export interface CreateAttributionParams {
  userId: string;
  referralCode: string;
  referrerUserId: string;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
}

export interface ReferralMetricsDay {
  date: string;
  clicks: number;
  signups: number;
}

export interface ReferralMetricsSummary {
  totalClicks: number;
  totalSignups: number;
  conversionRate: number;
  /** Usuarios referidos con ≥1 depósito aprobado (first-time depositors). */
  ftds: number;
}

export interface ReferralMetricsResult {
  period: ReferralMetricsDay[];
  summary: ReferralMetricsSummary;
}

export interface ReferredUser {
  id: string;
  username: string;
  displayName: string;
  attributedAt: Date;
  status: string;
}

export interface ReferredUsersResult {
  users: ReferredUser[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ReferralsService {
  /**
   * Retorna el código de referido del user. Si no lo tiene todavía,
   * lo genera (= username) y lo persiste.
   */
  async getOrCreateCode(
    db: TenantDb,
    userId: string,
  ): Promise<ReferralCodeInfo> {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        referralCode: users.referralCode,
        referralCodeGeneratedAt: users.referralCodeGeneratedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = rows[0];
    if (!user) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    // El admin NO tiene código de referido base: su "base" es el tráfico
    // orgánico (registro sin código → Socio madre). Sí puede crear campañas
    // (ver referral_codes). No generamos ni devolvemos código base para él.
    const roleRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
    if (roleRows.some((r) => r.code === 'admin_tenant')) {
      return { code: null, link: null, generatedAt: null };
    }

    if (user.referralCode) {
      return {
        code: user.referralCode,
        link: `/r/${user.referralCode}`,
        generatedAt: user.referralCodeGeneratedAt,
      };
    }

    const now = new Date();
    await db
      .update(users)
      .set({
        referralCode: user.username,
        referralCodeGeneratedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    return {
      code: user.username,
      link: `/r/${user.username}`,
      generatedAt: now,
    };
  }

  /** Tope de campañas ACTIVAS por usuario (desactivadas no cuentan). */
  private static readonly MAX_CAMPAIGN_CODES = 20;

  /**
   * Genera un código de campaña único: `<slug>-<rand>`, que NO colisiona con
   * ningún username/código base (users.referral_code) ni con otra campaña.
   * ≤20 chars y solo [a-z0-9-] (compatible con el DTO de registro `ref`).
   */
  private async generateCampaignCode(
    db: TenantDb,
    label: string,
  ): Promise<string> {
    const slug = label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 10);
    const base = slug.length >= 2 ? slug : 'camp';

    for (let attempt = 0; attempt < 8; attempt++) {
      const rand = randomBytes(4)
        .toString('hex')
        .slice(0, attempt < 4 ? 5 : 8);
      const candidate = `${base}-${rand}`.slice(0, 20);

      const userClash = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.referralCode, candidate))
        .limit(1);
      if (userClash.length > 0) continue;

      const codeClash = await db
        .select({ id: referralCodes.id })
        .from(referralCodes)
        .where(eq(referralCodes.code, candidate))
        .limit(1);
      if (codeClash.length > 0) continue;

      return candidate;
    }
    throw new ConflictException(
      'No se pudo generar un código único. Reintentá.',
    );
  }

  /** Clicks + signups de UN código (agregados desde eventos/atribuciones). */
  private async codeMetrics(
    db: TenantDb,
    userId: string,
    code: string,
  ): Promise<{ clicks: number; signups: number }> {
    const clickRows = await db
      .select({ total: count() })
      .from(referralClickEvents)
      .where(
        and(
          eq(referralClickEvents.referrerUserId, userId),
          eq(referralClickEvents.referralCode, code),
        ),
      );
    const signupRows = await db
      .select({ total: count() })
      .from(referralAttributions)
      .where(
        and(
          eq(referralAttributions.referrerUserId, userId),
          eq(referralAttributions.referralCode, code),
        ),
      );
    return {
      clicks: clickRows[0]?.total ?? 0,
      signups: signupRows[0]?.total ?? 0,
    };
  }

  /**
   * FTDs (usuarios referidos con ≥1 depósito aprobado) agrupados por código.
   * Un usuario cuenta una sola vez por código (distinct).
   */
  private async ftdByCode(
    db: TenantDb,
    userId: string,
  ): Promise<Map<string, number>> {
    const rows = await db
      .select({
        code: referralAttributions.referralCode,
        total: sql<number>`count(distinct ${referralAttributions.userId})`,
      })
      .from(referralAttributions)
      .innerJoin(
        deposits,
        and(
          eq(deposits.userId, referralAttributions.userId),
          eq(deposits.status, 'approved'),
        ),
      )
      .where(eq(referralAttributions.referrerUserId, userId))
      .groupBy(referralAttributions.referralCode);
    return new Map(rows.map((r) => [r.code, Number(r.total)]));
  }

  /** FTDs del usuario, opcionalmente filtrados por un código específico. */
  private async ftdCount(
    db: TenantDb,
    userId: string,
    code?: string,
  ): Promise<number> {
    const conds = [eq(referralAttributions.referrerUserId, userId)];
    if (code) conds.push(eq(referralAttributions.referralCode, code));
    const rows = await db
      .select({
        total: sql<number>`count(distinct ${referralAttributions.userId})`,
      })
      .from(referralAttributions)
      .innerJoin(
        deposits,
        and(
          eq(deposits.userId, referralAttributions.userId),
          eq(deposits.status, 'approved'),
        ),
      )
      .where(and(...conds));
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Lista los códigos del usuario: base (si es operador) + campañas, cada uno
   * con sus métricas agregadas por código (clicks + signups + FTD).
   */
  async listMyCodes(
    db: TenantDb,
    userId: string,
  ): Promise<MyReferralCodesResult> {
    const base = await this.getOrCreateCode(db, userId);

    const campaignRows = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.ownerUserId, userId))
      .orderBy(sql`${referralCodes.createdAt} DESC`);

    // Métricas por código en queries agrupadas (evita N+1).
    const clickRows = await db
      .select({
        code: referralClickEvents.referralCode,
        total: count(),
      })
      .from(referralClickEvents)
      .where(eq(referralClickEvents.referrerUserId, userId))
      .groupBy(referralClickEvents.referralCode);
    const signupRows = await db
      .select({
        code: referralAttributions.referralCode,
        total: count(),
      })
      .from(referralAttributions)
      .where(eq(referralAttributions.referrerUserId, userId))
      .groupBy(referralAttributions.referralCode);
    const ftdMap = await this.ftdByCode(db, userId);

    const clickMap = new Map(clickRows.map((r) => [r.code, r.total]));
    const signupMap = new Map(signupRows.map((r) => [r.code, r.total]));

    const baseItem: ReferralCodeListItem | null = base.code
      ? {
          id: null,
          code: base.code,
          label: base.code,
          isActive: true,
          isBase: true,
          link: base.link!,
          clicks: clickMap.get(base.code) ?? 0,
          signups: signupMap.get(base.code) ?? 0,
          ftds: ftdMap.get(base.code) ?? 0,
          createdAt: base.generatedAt,
        }
      : null;

    const campaigns: ReferralCodeListItem[] = campaignRows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      isActive: r.isActive,
      isBase: false,
      link: `/r/${r.code}`,
      clicks: clickMap.get(r.code) ?? 0,
      signups: signupMap.get(r.code) ?? 0,
      ftds: ftdMap.get(r.code) ?? 0,
      createdAt: r.createdAt,
    }));

    return {
      base: baseItem,
      campaigns,
      campaignCap: ReferralsService.MAX_CAMPAIGN_CODES,
    };
  }

  /** Cuenta campañas ACTIVAS del usuario (para el tope). */
  private async countActiveCampaigns(
    db: TenantDb,
    userId: string,
  ): Promise<number> {
    const rows = await db
      .select({ total: count() })
      .from(referralCodes)
      .where(
        and(
          eq(referralCodes.ownerUserId, userId),
          eq(referralCodes.isActive, true),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  /**
   * Crea una campaña para el usuario. Enforce tope de campañas ACTIVAS.
   * El código se auto-genera; la etiqueta la elige el dueño.
   */
  async createCampaignCode(
    db: TenantDb,
    userId: string,
    label: string,
  ): Promise<ReferralCodeListItem> {
    const active = await this.countActiveCampaigns(db, userId);
    if (active >= ReferralsService.MAX_CAMPAIGN_CODES) {
      throw new ConflictException(
        `Llegaste al máximo de ${ReferralsService.MAX_CAMPAIGN_CODES} campañas activas. Desactivá alguna para crear otra.`,
      );
    }

    const code = await this.generateCampaignCode(db, label);
    const now = new Date();
    const inserted = await db
      .insert(referralCodes)
      .values({
        ownerUserId: userId,
        code,
        label: label.trim(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = inserted[0]!;

    return {
      id: row.id,
      code: row.code,
      label: row.label,
      isActive: row.isActive,
      isBase: false,
      link: `/r/${row.code}`,
      clicks: 0,
      signups: 0,
      ftds: 0,
      createdAt: row.createdAt,
    };
  }

  /**
   * Renombra la etiqueta y/o (des)activa una campaña. Solo el dueño.
   * Reactivar respeta el tope de campañas activas.
   */
  async updateCampaignCode(
    db: TenantDb,
    userId: string,
    id: string,
    patch: { label?: string; isActive?: boolean },
  ): Promise<ReferralCodeListItem> {
    const existing = await db
      .select()
      .from(referralCodes)
      .where(and(eq(referralCodes.id, id), eq(referralCodes.ownerUserId, userId)))
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundException('Campaña no encontrada.');
    }

    // Reactivar respeta el tope.
    if (patch.isActive === true && !row.isActive) {
      const active = await this.countActiveCampaigns(db, userId);
      if (active >= ReferralsService.MAX_CAMPAIGN_CODES) {
        throw new ConflictException(
          `Llegaste al máximo de ${ReferralsService.MAX_CAMPAIGN_CODES} campañas activas.`,
        );
      }
    }

    const updates: { updatedAt: Date; label?: string; isActive?: boolean } = {
      updatedAt: new Date(),
    };
    if (patch.label !== undefined) updates.label = patch.label.trim();
    if (patch.isActive !== undefined) updates.isActive = patch.isActive;

    const updated = await db
      .update(referralCodes)
      .set(updates)
      .where(eq(referralCodes.id, id))
      .returning();
    const newRow = updated[0]!;

    const metrics = await this.codeMetrics(db, userId, newRow.code);
    const ftds = await this.ftdCount(db, userId, newRow.code);
    return {
      id: newRow.id,
      code: newRow.code,
      label: newRow.label,
      isActive: newRow.isActive,
      isBase: false,
      link: `/r/${newRow.code}`,
      clicks: metrics.clicks,
      signups: metrics.signups,
      ftds,
      createdAt: newRow.createdAt,
    };
  }

  /**
   * Resuelve un código (BASE o de CAMPAÑA) al dueño + su info.
   *   - Base: `users.referral_code`.
   *   - Campaña: `referral_codes` (solo activas).
   * Devuelve null si el código no existe.
   */
  private async resolveCodeToOwner(
    db: TenantDb,
    code: string,
  ): Promise<{
    ownerUserId: string;
    status: string;
    displayName: string;
    roleCodes: string[];
    isCampaign: boolean;
  } | null> {
    // 1. Código base (users.referral_code).
    const baseRows = await db
      .select({ id: users.id, status: users.status, displayName: users.displayName })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);
    let ownerRow = baseRows[0] ?? null;
    let isCampaign = false;

    // 2. Si no matcheó como base, buscar campaña ACTIVA (referral_codes).
    if (!ownerRow) {
      const campRows = await db
        .select({ ownerUserId: referralCodes.ownerUserId })
        .from(referralCodes)
        .where(and(eq(referralCodes.code, code), eq(referralCodes.isActive, true)))
        .limit(1);
      const campOwnerId = campRows[0]?.ownerUserId ?? null;
      if (campOwnerId) {
        const ownerRows = await db
          .select({ id: users.id, status: users.status, displayName: users.displayName })
          .from(users)
          .where(eq(users.id, campOwnerId))
          .limit(1);
        ownerRow = ownerRows[0] ?? null;
        isCampaign = true;
      }
    }

    if (!ownerRow) return null;

    const roleRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, ownerRow.id));

    return {
      ownerUserId: ownerRow.id,
      status: ownerRow.status,
      displayName: ownerRow.displayName,
      roleCodes: roleRows.map((r) => r.code),
      isCampaign,
    };
  }

  /**
   * Lookup público: resuelve un código (base o campaña) al display_name del
   * referrer. Para la landing page de registro. Valida que esté activo.
   */
  async resolveCode(
    db: TenantDb,
    code: string,
  ): Promise<ReferralResolveResult> {
    const owner = await this.resolveCodeToOwner(db, code);
    if (!owner || owner.status !== 'active') {
      return { displayName: '', valid: false };
    }
    return { displayName: owner.displayName, valid: true };
  }

  /**
   * Lookup de referrer por código, usado por POST /register.
   *   - Operador (socio/distri/cajero): atribuye + auto-parent.
   *   - CAMPAÑA del admin: atribuye SIN auto-parent (jugadores del admin son
   *     root, docs/03) → para trackear campañas del admin (ej. Instagram).
   *   - Resto: null (no atribuye).
   */
  async resolveReferrerId(
    db: TenantDb,
    code: string,
  ): Promise<ReferrerInfo | null> {
    const owner = await this.resolveCodeToOwner(db, code);
    if (!owner || owner.status !== 'active') return null;

    const isOperator = owner.roleCodes.some((r) =>
      ['socio', 'distribuidor', 'cajero'].includes(r),
    );
    if (isOperator) {
      return { id: owner.ownerUserId, roleCodes: owner.roleCodes, skipAutoParent: false };
    }
    if (owner.isCampaign && owner.roleCodes.includes('admin_tenant')) {
      return { id: owner.ownerUserId, roleCodes: owner.roleCodes, skipAutoParent: true };
    }
    return null;
  }

  /**
   * Registra un click en un link de referido (base o campaña).
   */
  async trackClick(
    db: TenantDb,
    code: string,
    ip: string | null,
    userAgent: string | null,
    referer: string | null,
  ): Promise<void> {
    const owner = await this.resolveCodeToOwner(db, code);
    if (!owner) return;

    await db.insert(referralClickEvents).values({
      referralCode: code,
      referrerUserId: owner.ownerUserId,
      ip: ip ?? undefined,
      userAgent: userAgent ?? undefined,
      referer: referer ?? undefined,
    });
  }

  /**
   * Crea una referral_attribution para un jugador registrado vía link.
   *
   * Llamado desde el controller después de crear el usuario.
   */
  async createAttribution(
    db: TenantDb,
    params: CreateAttributionParams,
  ): Promise<void> {
    await db.insert(referralAttributions).values({
      userId: params.userId,
      referralCode: params.referralCode,
      referrerUserId: params.referrerUserId,
      attributionMethod: 'click',
      ip: params.ip ?? undefined,
      userAgent: params.userAgent ?? undefined,
      referer: params.referer ?? undefined,
    });
  }

  /**
   * Métricas del operador: clicks totales y registros atribuidos.
   *
   * totalSignups ahora usa referral_attributions (Fase 2) en lugar
   * de user_hierarchy para atribución precisa.
   */
  async getMyStats(
    db: TenantDb,
    userId: string,
  ): Promise<ReferralMyStats> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const clickRows = await db
      .select({ total: count() })
      .from(referralClickEvents)
      .where(
        and(
          eq(referralClickEvents.referrerUserId, userId),
          gte(referralClickEvents.clickedAt, ninetyDaysAgo),
        ),
      );

    const totalClicks = clickRows[0]?.total ?? 0;

    // Total signups via referral_attributions.
    const signupRows = await db
      .select({ total: count() })
      .from(referralAttributions)
      .where(
        and(
          eq(referralAttributions.referrerUserId, userId),
          gte(referralAttributions.attributedAt, ninetyDaysAgo),
        ),
      );

    const totalSignups = signupRows[0]?.total ?? 0;

    return { totalClicks, totalSignups };
  }

  /**
   * Métricas time-series: clicks y signups agrupados por día.
   * Rellena días sin datos con ceros para que los charts se vean continuos.
   */
  async getMyMetrics(
    db: TenantDb,
    userId: string,
    days: number,
    code?: string,
  ): Promise<ReferralMetricsResult> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Clicks por día (opcionalmente filtrado por código).
    const clickConds = [
      eq(referralClickEvents.referrerUserId, userId),
      gte(referralClickEvents.clickedAt, since),
    ];
    if (code) clickConds.push(eq(referralClickEvents.referralCode, code));
    const clickRows = await db
      .select({
        date: sql<string>`date_trunc('day', ${referralClickEvents.clickedAt})::text`,
        clicks: count(),
      })
      .from(referralClickEvents)
      .where(and(...clickConds))
      .groupBy(sql`date_trunc('day', ${referralClickEvents.clickedAt})`)
      .orderBy(sql`date_trunc('day', ${referralClickEvents.clickedAt})`);

    // Signups por día (opcionalmente filtrado por código).
    const signupConds = [
      eq(referralAttributions.referrerUserId, userId),
      gte(referralAttributions.attributedAt, since),
    ];
    if (code) signupConds.push(eq(referralAttributions.referralCode, code));
    const signupRows = await db
      .select({
        date: sql<string>`date_trunc('day', ${referralAttributions.attributedAt})::text`,
        signups: count(),
      })
      .from(referralAttributions)
      .where(and(...signupConds))
      .groupBy(sql`date_trunc('day', ${referralAttributions.attributedAt})`)
      .orderBy(sql`date_trunc('day', ${referralAttributions.attributedAt})`);

    // Index por día para merge rápido.
    const clickMap = new Map<string, number>();
    for (const row of clickRows) {
      clickMap.set(row.date.slice(0, 10), row.clicks);
    }
    const signupMap = new Map<string, number>();
    for (const row of signupRows) {
      signupMap.set(row.date.slice(0, 10), row.signups);
    }

    // Generar array completo con ceros para días sin datos.
    const period: ReferralMetricsDay[] = [];
    const cursor = new Date(since);
    const now = new Date();
    while (cursor <= now) {
      const key = cursor.toISOString().slice(0, 10);
      period.push({
        date: key,
        clicks: clickMap.get(key) ?? 0,
        signups: signupMap.get(key) ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const totalClicks = period.reduce((s, d) => s + d.clicks, 0);
    const totalSignups = period.reduce((s, d) => s + d.signups, 0);
    const conversionRate =
      totalClicks > 0
        ? Math.round((totalSignups / totalClicks) * 10000) / 100
        : 0;
    // FTD es acumulado (no time-series): total de depositantes referidos.
    const ftds = await this.ftdCount(db, userId, code);

    return {
      period,
      summary: { totalClicks, totalSignups, conversionRate, ftds },
    };
  }

  /**
   * Lista paginada de usuarios referidos (attributionados al operador).
   */
  async getReferredUsers(
    db: TenantDb,
    userId: string,
    page: number,
    limit: number,
    code?: string,
  ): Promise<ReferredUsersResult> {
    const offset = (page - 1) * limit;

    const conds = [eq(referralAttributions.referrerUserId, userId)];
    if (code) conds.push(eq(referralAttributions.referralCode, code));

    // Count total.
    const countRows = await db
      .select({ total: count() })
      .from(referralAttributions)
      .where(and(...conds));
    const total = countRows[0]?.total ?? 0;

    // Fetch page.
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        attributedAt: referralAttributions.attributedAt,
        status: users.status,
      })
      .from(referralAttributions)
      .innerJoin(users, eq(referralAttributions.userId, users.id))
      .where(and(...conds))
      .orderBy(sql`${referralAttributions.attributedAt} DESC`)
      .limit(limit)
      .offset(offset);

    return {
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        attributedAt: r.attributedAt,
        status: r.status,
      })),
      total,
      page,
      limit,
    };
  }
}
