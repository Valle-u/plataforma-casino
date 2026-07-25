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

import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq, gte } from 'drizzle-orm';
import {
  referralAttributions,
  referralClickEvents,
  roles,
  userRoles,
  users,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export interface ReferralCodeInfo {
  code: string;
  link: string;
  generatedAt: Date | null;
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
}

export interface CreateAttributionParams {
  userId: string;
  referralCode: string;
  referrerUserId: string;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
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

  /**
   * Lookup público: resuelve un código de referido al display_name
   * del referrer. Para la landing page de registro.
   *
   * Valida que el user exista y esté activo.
   */
  async resolveCode(
    db: TenantDb,
    code: string,
  ): Promise<ReferralResolveResult> {
    const rows = await db
      .select({
        displayName: users.displayName,
        status: users.status,
      })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);

    const user = rows[0];
    if (!user || user.status !== 'active') {
      return { displayName: '', valid: false };
    }

    return { displayName: user.displayName, valid: true };
  }

  /**
   * Lookup de referrer por código: retorna user ID + roles.
   * Usado por el endpoint POST /register para el auto-parent.
   *
   * Solo retorna si el referrer está activo y tiene rol operativo
   * (socio/distribuidor/cajero). Si no → null.
   */
  async resolveReferrerId(
    db: TenantDb,
    code: string,
  ): Promise<ReferrerInfo | null> {
    const rows = await db
      .select({
        id: users.id,
        status: users.status,
      })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);

    const referrer = rows[0];
    if (!referrer || referrer.status !== 'active') return null;

    // Obtener roles del referrer.
    const roleRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, referrer.id));

    const roleCodes = roleRows.map((r) => r.code);

    // Solo operadores pueden ser referrers.
    const isOperator = roleCodes.some((r) =>
      ['socio', 'distribuidor', 'cajero'].includes(r),
    );
    if (!isOperator) return null;

    return { id: referrer.id, roleCodes };
  }

  /**
   * Registra un click en un link de referido.
   */
  async trackClick(
    db: TenantDb,
    code: string,
    ip: string | null,
    userAgent: string | null,
    referer: string | null,
  ): Promise<void> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);

    const referrer = rows[0];
    if (!referrer) return;

    await db.insert(referralClickEvents).values({
      referralCode: code,
      referrerUserId: referrer.id,
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
}
