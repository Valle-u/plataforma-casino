/**
 * PartnerBrandingService — diseño propio de un SOCIO INDEPENDIENTE (Etapa 1).
 *
 * Dos usos:
 *  - EDICIÓN: el socio independiente guarda/lee LO SUYO (getMine/saveMine).
 *  - RESOLUCIÓN: el endpoint público del player (`/tenant/info`) resuelve qué
 *    diseño mostrarle a un visitante (resolveForViewer): el del socio del que
 *    cuelga (por su cuenta logueada o por el código de referido), o null →
 *    el default del tenant.
 */

import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { partnerBranding, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import type { TenantJwtPayload } from '../tenant-auth/tenant-auth.service';

@Injectable()
export class PartnerBrandingService {
  constructor(
    private readonly jwt: JwtService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  // ── Edición (el socio edita su propio diseño) ────────────────────────────

  /**
   * Solo un socio INDEPENDIENTE puede tener/editar diseño propio. El flag
   * `is_independent_branch` solo se setea en socios, así que alcanza con él.
   */
  private async assertIndependentSocio(
    db: TenantDb,
    actorId: string,
  ): Promise<void> {
    if (!(await this.isIndependent(db, actorId))) {
      throw new ForbiddenException({
        message:
          'Solo los socios independientes pueden personalizar el diseño de su casino.',
        error: 'NOT_INDEPENDENT_SOCIO',
      });
    }
  }

  private async isIndependent(db: TenantDb, userId: string): Promise<boolean> {
    const rows = await db
      .select({ indep: users.isIndependentBranch })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.indep === true;
  }

  /** Devuelve el config de diseño del socio actor (null si no configuró). */
  async getMine(
    db: TenantDb,
    actorId: string,
  ): Promise<Record<string, unknown> | null> {
    await this.assertIndependentSocio(db, actorId);
    return this.configOf(db, actorId);
  }

  /** Upsert del diseño del socio actor (1 diseño por socio). */
  async saveMine(
    db: TenantDb,
    actorId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    await this.assertIndependentSocio(db, actorId);
    await db
      .insert(partnerBranding)
      .values({ ownerUserId: actorId, config })
      .onConflictDoUpdate({
        target: partnerBranding.ownerUserId,
        set: { config, updatedAt: new Date() },
      });
  }

  // ── Resolución (qué diseño ve un visitante del player) ───────────────────

  /**
   * Resuelve el diseño que debe ver un visitante. Devuelve el config del socio
   * independiente "dueño" del visitante, o null (→ usar el default del tenant).
   * El dueño se determina por el jugador logueado (token) o por el código de
   * referido (?ref=). Todo defensivo: cualquier fallo → null (default).
   */
  async resolveForViewer(
    db: TenantDb,
    tenantId: string,
    opts: { token?: string; refCode?: string },
  ): Promise<Record<string, unknown> | null> {
    try {
      const seedId =
        (await this.userIdFromToken(tenantId, opts.token)) ??
        (opts.refCode ? await this.resolveRefCode(db, opts.refCode) : null);
      if (!seedId) return null;
      const ownerId = await this.resolveDesignOwner(db, seedId);
      if (!ownerId) return null;
      return this.configOf(db, ownerId);
    } catch {
      return null;
    }
  }

  private async configOf(
    db: TenantDb,
    ownerId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await db
      .select({ config: partnerBranding.config })
      .from(partnerBranding)
      .where(eq(partnerBranding.ownerUserId, ownerId))
      .limit(1);
    const cfg = rows[0]?.config;
    return cfg && typeof cfg === 'object'
      ? (cfg as Record<string, unknown>)
      : null;
  }

  /** Verifica el token (opcional); devuelve el userId si es válido para el tenant. */
  private async userIdFromToken(
    tenantId: string,
    token?: string,
  ): Promise<string | null> {
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<TenantJwtPayload>(token);
      if (payload.tenantId !== tenantId) return null; // anti cross-tenant
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  /** "Socio independiente más cercano hacia arriba, incluyéndose a sí mismo." */
  private async resolveDesignOwner(
    db: TenantDb,
    seedId: string,
  ): Promise<string | null> {
    if (await this.isIndependent(db, seedId)) return seedId;
    return this.hierarchy.getNearestIndependentBranchAncestor(db, seedId);
  }

  /** Código de referido base (== username) → userId del referrer. */
  private async resolveRefCode(
    db: TenantDb,
    code: string,
  ): Promise<string | null> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);
    return rows[0]?.id ?? null;
  }
}
