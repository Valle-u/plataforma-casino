/**
 * PartnerBrandingService — diseño propio de un SOCIO INDEPENDIENTE (Etapa 1).
 *
 * Un socio independiente puede tener su propia versión visual del casino
 * (config = misma forma que design.config del tenant). Solo él edita LO SUYO.
 * Si no configuró nada, su red ve el diseño default del tenant.
 */

import { ForbiddenException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { partnerBranding, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

@Injectable()
export class PartnerBrandingService {
  /**
   * Solo un socio INDEPENDIENTE puede tener/editar diseño propio. El flag
   * `is_independent_branch` solo se setea en socios, así que alcanza con él.
   */
  private async assertIndependentSocio(
    db: TenantDb,
    actorId: string,
  ): Promise<void> {
    const rows = await db
      .select({ indep: users.isIndependentBranch })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    if (!rows[0]?.indep) {
      throw new ForbiddenException({
        message:
          'Solo los socios independientes pueden personalizar el diseño de su casino.',
        error: 'NOT_INDEPENDENT_SOCIO',
      });
    }
  }

  /** Devuelve el config de diseño del socio actor (null si no configuró). */
  async getMine(
    db: TenantDb,
    actorId: string,
  ): Promise<Record<string, unknown> | null> {
    await this.assertIndependentSocio(db, actorId);
    const rows = await db
      .select({ config: partnerBranding.config })
      .from(partnerBranding)
      .where(eq(partnerBranding.ownerUserId, actorId))
      .limit(1);
    return (rows[0]?.config as Record<string, unknown> | undefined) ?? null;
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
}
