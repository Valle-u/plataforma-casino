/**
 * ReferralsService — Fase 1 del sistema de links de referido.
 *
 * Responsabilidades:
 *   1. getOrCreateCode(userId) — fija referral_code = username (one-time).
 *   2. resolveCode(code) — lookup público: code → displayName del referrer.
 *   3. trackClick(code, ip, ua, referer) — inserta click event.
 *   4. getMyStats(userId) — total clicks + signups del operador.
 *
 * NO muta jerarquía, NO crea usuarios, NO mueve fichas.
 * Solo lectura + click tracking.
 *
 * Leyes aplicables: R3 (marketing, no plata), P1 (scope), P4 (multi-tenant).
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { referralClickEvents, users } from '@casino/db';
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

    // Si ya tiene código, retornarlo.
    if (user.referralCode) {
      return {
        code: user.referralCode,
        link: `/r/${user.referralCode}`,
        generatedAt: user.referralCodeGeneratedAt,
      };
    }

    // Generar: code = username. Si por alguna razón ya existe (race
    // condition), el UNIQUE constraint lo atrapa y reintentamos.
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
   * del referrer. Para la futura landing page de registro.
   *
   * Valida que el user exista, esté activo y tenga un rol operativo
   * (socio/distribuidor/cajero).
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
   * Registra un click en un link de referido.
   * Rate limiting se maneja a nivel controller (in-memory o Redis).
   */
  async trackClick(
    db: TenantDb,
    code: string,
    ip: string | null,
    userAgent: string | null,
    referer: string | null,
  ): Promise<void> {
    // Lookup del referrer por código.
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);

    const referrer = rows[0];
    if (!referrer) return; // código inválido → silencioso (no revelar existencia)

    await db.insert(referralClickEvents).values({
      referralCode: code,
      referrerUserId: referrer.id,
      ip: ip ?? undefined,
      userAgent: userAgent ?? undefined,
      referer: referer ?? undefined,
    });
  }

  /**
   * Métricas del operador: clicks totales y registros atribuidos.
   *
   * totalSignups se calcula contando usuarios cuyo parent en la
   * jerarquía es el actor (simplificación: futura Fase 2 usará
   * referral_attributions para atribución precisa).
   */
  async getMyStats(
    db: TenantDb,
    userId: string,
  ): Promise<ReferralMyStats> {
    // Total clicks en los últimos 90 días.
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

    // Total signups: usuarios que tienen al actor como padre activo
    // en user_hierarchy (simplificación para Fase 1 sin referral_attributions).
    const signupRows = await db
      .select({ total: count() })
      .from(users)
      .where(
        sql`${users.id} IN (
          SELECT uh.user_id FROM user_hierarchy uh
          WHERE uh.parent_user_id = ${userId} AND uh.until IS NULL
        )`,
      );

    const totalSignups = signupRows[0]?.total ?? 0;

    return { totalClicks, totalSignups };
  }
}
