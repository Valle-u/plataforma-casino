/**
 * AchievementsController — Sprint 52.2.
 *
 * Endpoints player-facing del sistema de achievements.
 *
 *   GET  /tenant/achievements/definitions   catálogo activo.
 *   GET  /tenant/achievements/me            mis unlocks (con defs).
 *   POST /tenant/achievements/me/check      dispara check + grant +
 *                                           devuelve unlocks nuevos.
 *
 * Cualquier user logueado puede consumir. Sin permission especial.
 * El check no es expensive (1 wallet + 1 stats + 3-4 queries small) →
 * lo llamamos desde el cliente en eventos como "después de un win" o
 * "después de claim de promo".
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { AchievementsService } from './achievements.service';

@Controller('tenant/achievements')
@UseGuards(TenantJwtGuard)
export class AchievementsController {
  constructor(
    private readonly service: AchievementsService,
    private readonly audit: AuditLogService,
  ) {}

  /** GET /tenant/achievements/definitions — catálogo activo, sin user data. */
  @Get('definitions')
  async listDefinitions(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    const defs = await this.service.listDefinitions(db);
    return { data: defs };
  }

  /**
   * GET /tenant/achievements/me — listado combinado: cada def +
   * unlockedAt (null si locked) + rewardWalletTxId.
   */
  @Get('me')
  async getMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const data = await this.service.listForUser(db, actor.id);
    return { data };
  }

  /**
   * POST /tenant/achievements/me/check — corre check + grant + reward.
   *
   * Devuelve sólo los unlocks NUEVOS de este check. Si no había ninguno,
   * `data: []`.
   *
   * Idempotente: llamar muchas veces no daña nada (UNIQUE constraint
   * en user_achievements + idempotency key en mint).
   *
   * El client lo llama estratégicamente:
   *   - On wallet refresh detecta incremento → check (probablemente ganó).
   *   - On streak/wheel claim success → check.
   *   - On deposit approved (notif arrive) → check.
   *   - Periódicamente al cargar /play (1 vez por sesión) como safety net.
   */
  @Post('me/check')
  @HttpCode(HttpStatus.OK)
  async checkMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const newUnlocks = await this.service.checkAndGrant(db, actor.id);

    // Audit log sólo si hubo unlocks (no inundar audit con checks vacíos).
    if (newUnlocks.length > 0) {
      for (const u of newUnlocks) {
        await this.audit.record(db, {
          actorUserId: actor.id,
          actorUsername: actor.username,
          actionCode: 'achievement.grant',
          targetType: 'achievement',
          targetId: u.code,
          metadata: {
            rewardChips: u.rewardChips,
            rewardWalletTxId: u.rewardWalletTxId,
            severity: 'low',
          },
          ...extractRequestContext(req),
        });
      }
    }

    return { data: newUnlocks };
  }
}
