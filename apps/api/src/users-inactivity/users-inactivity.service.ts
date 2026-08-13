/**
 * UsersInactivityService — desactiva JUGADORES dormidos.
 *
 * Un jugador (rol `usuario_final`) que no inicia sesión hace más de
 * `users.inactivity_days` días (setting del tenant, configurable) pasa a
 * `status='inactive'`. El login le muestra un mensaje para contactar a
 * soporte y reactivar la cuenta. La reactivación es manual (admin/soporte
 * pone el status en `active`).
 *
 * Reglas duras:
 *   - `users.inactivity_days = 0` → feature APAGADA para ese tenant (no toca
 *     a nadie).
 *   - SOLO jugadores (`usuario_final`). Nunca staff/operadores/admin — así no
 *     bloqueamos al equipo por no entrar al panel.
 *   - Nunca cuentas de sistema (`is_system`).
 *   - Referencia de actividad: `last_login_at`; si nunca entró, `created_at`.
 *
 * Idempotente: corre a diario; el que ya está `inactive` no se vuelve a tocar
 * (el filtro exige `status='active'`).
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { roles, userRoles, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { AuditLogService } from '../audit/audit-log.service';

const DEFAULT_INACTIVITY_DAYS = 90;

export interface InactivityScanResult {
  enabled: boolean;
  days: number;
  deactivated: number;
}

@Injectable()
export class UsersInactivityService {
  private readonly logger = new Logger(UsersInactivityService.name);

  constructor(
    private readonly tenantSettings: TenantSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  async runScan(db: TenantDb): Promise<InactivityScanResult> {
    const days = await this.tenantSettings.getNumeric(
      db,
      'users.inactivity_days',
      DEFAULT_INACTIVITY_DAYS,
    );
    if (days <= 0) {
      return { enabled: false, days: 0, deactivated: 0 };
    }

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Subquery: ids de usuarios con rol jugador (usuario_final).
    const playerIds = db
      .select({ id: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(roles.code, 'usuario_final'));

    const deactivated = await db
      .update(users)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(
        and(
          eq(users.status, 'active'),
          eq(users.isSystem, false),
          inArray(users.id, playerIds),
          sql`coalesce(${users.lastLoginAt}, ${users.createdAt}) < ${cutoff}`,
        ),
      )
      .returning({ id: users.id });

    if (deactivated.length > 0) {
      this.logger.log(
        `Inactividad: ${deactivated.length} jugador(es) marcados inactive (>${days}d sin entrar).`,
      );
      try {
        await this.audit.record(db, {
          actorUserId: null,
          actionCode: 'users.deactivate_inactive',
          targetType: 'user',
          targetId: null,
          metadata: {
            count: deactivated.length,
            days,
            cutoff: cutoff.toISOString(),
            severity: 'medium',
          },
        });
      } catch (err) {
        this.logger.error(
          `No se pudo auditar la desactivación: ${(err as Error).message}`,
        );
      }
    }

    return { enabled: true, days, deactivated: deactivated.length };
  }
}
