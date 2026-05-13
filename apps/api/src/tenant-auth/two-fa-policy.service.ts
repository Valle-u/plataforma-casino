/**
 * TwoFaPolicyService — enforcement de "2FA obligatorio para roles operativos".
 *
 * Regla:
 *   - Si el user tiene AL MENOS un rol con `requires_two_fa = true` y
 *     `two_fa_enabled = false`, todas sus requests post-auth (con JWT)
 *     fallan con 403 TWO_FA_SETUP_REQUIRED — EXCEPTO los endpoints
 *     marcados `@AllowWithoutTwoFa()` (típicamente: GET /me, 2fa/init,
 *     2fa/confirm, logout, recovery-codes/count).
 *
 * Diseño:
 *   - El service es mutable (`enable()` / `disable()`). Default ENABLED
 *     en producción (`TWO_FA_POLICY_ENABLED=true` o ausente).
 *   - `bootstrapTestApp` deshabilita por default para no romper los 199
 *     tests existentes (que asumen admin/cajeros sin 2FA). El suite
 *     dedicado del policy lo re-habilita.
 *   - Query a roles via JOIN — una sola round-trip a DB por request.
 *     Más adelante: cachear por user_id+role_changes (sprint Performance).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import { roles, userRoles, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export interface PolicyCheckResult {
  ok: boolean;
  /**
   * Solo si !ok. Identifica el motivo:
   *   - 'TWO_FA_SETUP_REQUIRED': el user tiene rol operativo sin 2FA.
   */
  reason?: 'TWO_FA_SETUP_REQUIRED';
}

@Injectable()
export class TwoFaPolicyService {
  private readonly logger = new Logger(TwoFaPolicyService.name);
  private enabled: boolean;

  constructor(config: ConfigService) {
    const raw = config.get<string>('TWO_FA_POLICY_ENABLED');
    // Default: enabled. Sólo se desactiva si explícitamente
    // `TWO_FA_POLICY_ENABLED=false`.
    this.enabled = raw !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'TwoFaPolicy DISABLED via TWO_FA_POLICY_ENABLED=false.',
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Solo para tests (o para un kill-switch admin si se agrega en futuro). */
  enable(): void {
    this.enabled = true;
  }

  /** Solo para tests. */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Chequea si el user cumple con la policy de 2FA para roles operativos.
   *
   * Lógica:
   *   1. Si la policy está disabled → ok (bypass total).
   *   2. Si el user tiene `two_fa_enabled = true` → ok (cumple).
   *   3. Si el user NO tiene ningún rol con `requires_two_fa = true` → ok
   *      (no es operativo, no se le exige).
   *   4. Else → TWO_FA_SETUP_REQUIRED.
   *
   * Performance: 1 query con JOIN entre user_roles y roles. El user_id
   * es indexado en user_roles.
   */
  async check(db: TenantDb, userId: string): Promise<PolicyCheckResult> {
    if (!this.enabled) return { ok: true };

    // 1. ¿El user ya tiene 2FA enabled? (cubre el caso "cumple").
    const userRow = await db
      .select({ enabled: users.twoFaEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (userRow[0]?.enabled === true) {
      return { ok: true };
    }

    // 2. ¿El user tiene algún rol que requiere 2FA?
    const operativeRoles = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.requiresTwoFa, true)))
      .limit(1);

    if (operativeRoles.length === 0) {
      // No es operativo — no se le exige 2FA.
      return { ok: true };
    }

    return { ok: false, reason: 'TWO_FA_SETUP_REQUIRED' };
  }

  /**
   * Variante: chequea contra un set de role codes en vez de role IDs.
   * Útil cuando ya tenés los codes en memoria (e.g. effective-permissions
   * cache).
   */
  async checkForRoleCodes(
    db: TenantDb,
    userId: string,
    roleCodes: string[],
  ): Promise<PolicyCheckResult> {
    if (!this.enabled) return { ok: true };

    const userRow = await db
      .select({ enabled: users.twoFaEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (userRow[0]?.enabled === true) return { ok: true };

    if (roleCodes.length === 0) return { ok: true };

    const found = await db
      .select({ code: roles.code })
      .from(roles)
      .where(and(inArray(roles.code, roleCodes), eq(roles.requiresTwoFa, true)))
      .limit(1);

    if (found.length === 0) return { ok: true };
    return { ok: false, reason: 'TWO_FA_SETUP_REQUIRED' };
  }
}
