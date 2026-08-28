/**
 * TwoFaService — gestión de 2FA TOTP (RFC 6238) per-user.
 *
 * Flujo:
 *   1. `initSetup(userId)`: genera un secret base32 (160 bits) y lo
 *      guarda en users.two_fa_secret con `two_fa_enabled = false`.
 *      Devuelve el secret + un otpauth:// URL para que el frontend
 *      genere QR (Google Authenticator, Authy, etc).
 *   2. El user escanea el QR en su app y obtiene un código de 6 dígitos.
 *   3. `confirmSetup(userId, code)`: valida el código contra el secret.
 *      Si OK, marca `two_fa_enabled = true`. Si no, tira `Invalid`.
 *   4. `verify(userId, code)`: utility usada en login y operaciones
 *      sensibles (mint/burn/permission delegation/etc).
 *   5. `disable(userId, code)`: requiere código válido. Limpia secret +
 *      enabled = false. Audit log con severity:high.
 *
 * Window de validación: tolerancia de ±1 step (30s atrás + 30s adelante)
 * para compensar drift de reloj entre cliente y servidor.
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { users, type User } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { RecoveryCodesService } from './recovery-codes.service';
import { TwoFaPolicyService } from './two-fa-policy.service';
import {
  TwoFaAlreadyEnabledError,
  TwoFaCodeInvalidError,
  TwoFaNotInitializedError,
} from './two-fa.errors';

/**
 * Tolerancia (en segundos) para verify(). 30s = ±1 step.
 * Soluciona drift de reloj entre la app TOTP del user y el server.
 */
const EPOCH_TOLERANCE_SECONDS = 30;

export interface SetupInitResult {
  secret: string;
  otpauthUrl: string;
}

@Injectable()
export class TwoFaService {
  constructor(
    private readonly recoveryCodes: RecoveryCodesService,
    private readonly twoFaPolicy: TwoFaPolicyService,
  ) {}

  /**
   * Inicia el setup: genera un secret nuevo, lo persiste con
   * enabled=false, devuelve datos para QR.
   *
   * Si el user ya tiene 2FA enabled, tira `TwoFaAlreadyEnabledError`.
   * Si tiene un setup pending (secret seteado pero enabled=false),
   * lo REEMPLAZA — el user puede recomenzar el flow.
   */
  async initSetup(
    db: TenantDb,
    userId: string,
    tenantSlug: string,
  ): Promise<SetupInitResult> {
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = rows[0];
    if (!user) throw new Error(`User ${userId} no existe.`);
    if (user.twoFaEnabled) throw new TwoFaAlreadyEnabledError();

    const secret = generateSecret();
    await db
      .update(users)
      .set({ twoFaSecret: secret, twoFaEnabled: false, updatedAt: new Date() })
      .where(eq(users.id, userId));

    const label = `${tenantSlug}:${user.username}`;
    const issuer = `Casino-${tenantSlug}`;
    const otpauthUrl = generateURI({ issuer, label, secret });
    return { secret, otpauthUrl };
  }

  /**
   * Confirma el setup con un código TOTP. Solo después de confirm el
   * sistema empieza a EXIGIR 2FA al user.
   *
   * Devuelve los 10 recovery codes generados — el frontend DEBE mostrarlos
   * al user en este punto (UNA sola vez; el server solo persiste el hash).
   */
  async confirmSetup(
    db: TenantDb,
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.loadUserOrThrow(db, userId);
    if (!user.twoFaSecret) throw new TwoFaNotInitializedError();
    if (user.twoFaEnabled) throw new TwoFaAlreadyEnabledError();

    if (!this.checkToken(code, user.twoFaSecret)) {
      throw new TwoFaCodeInvalidError();
    }

    await db
      .update(users)
      .set({ twoFaEnabled: true, updatedAt: new Date() })
      .where(eq(users.id, userId));

    // Generar y devolver recovery codes. El user los guarda en papel/manager.
    const { codes } = await this.recoveryCodes.generateForUser(db, userId);
    return { recoveryCodes: codes };
  }

  /**
   * Regenera el batch de recovery codes (invalidando los anteriores).
   * Requiere TOTP fresco para evitar que un atacante con sesión robada
   * rote los codes a su gusto.
   */
  async regenerateRecoveryCodes(
    db: TenantDb,
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.loadUserOrThrow(db, userId);
    if (!user.twoFaSecret || !user.twoFaEnabled) {
      throw new TwoFaNotInitializedError();
    }
    if (!this.checkToken(code, user.twoFaSecret)) {
      throw new TwoFaCodeInvalidError();
    }
    const { codes } = await this.recoveryCodes.generateForUser(db, userId);
    return { recoveryCodes: codes };
  }

  /**
   * Desactiva 2FA. Requiere código válido para evitar que un atacante
   * que tomó la sesión lo apague silenciosamente.
   */
  async disable(db: TenantDb, userId: string, code: string): Promise<void> {
    const user = await this.loadUserOrThrow(db, userId);
    if (!user.twoFaSecret || !user.twoFaEnabled) {
      throw new TwoFaNotInitializedError();
    }
    if (!this.checkToken(code, user.twoFaSecret)) {
      throw new TwoFaCodeInvalidError();
    }
    await db
      .update(users)
      .set({ twoFaSecret: null, twoFaEnabled: false, updatedAt: new Date() })
      .where(eq(users.id, userId));
    // Si el user apaga 2FA, los recovery codes pierden razón de ser.
    // Los borramos para no dejar codes huérfanos en la DB.
    await this.recoveryCodes.deleteAllForUser(db, userId);
  }

  /**
   * Verifica un código contra el secret del user. Helper para login y
   * para operaciones sensibles (mint/burn). Tira `TwoFaCodeInvalidError`
   * si el código no matchea o el user no tiene 2FA activo.
   *
   * NOTA: si el user NO tiene 2FA enabled, esto NO valida nada — el
   * caller debe decidir si exigir 2FA solo cuando enabled.
   */
  async verify(db: TenantDb, userId: string, code: string): Promise<void> {
    const user = await this.loadUserOrThrow(db, userId);
    if (!user.twoFaSecret || !user.twoFaEnabled) {
      // No tiene 2FA activo. El caller decide qué hacer.
      throw new TwoFaCodeInvalidError();
    }
    if (!this.checkToken(code, user.twoFaSecret)) {
      throw new TwoFaCodeInvalidError();
    }
  }

  /**
   * Wrapper alrededor de `verifySync` con la tolerancia estándar.
   * Centraliza el contrato — si mañana cambiamos a verify() async o ajustamos
   * la ventana, un solo punto.
   */
  private checkToken(token: string, secret: string): boolean {
    const result = verifySync({ token, secret, epochTolerance: EPOCH_TOLERANCE_SECONDS });
    return result.valid;
  }

  /**
   * Verifica y CONSUME un recovery code. Útil en login cuando el user no
   * tiene acceso a su app TOTP. Si OK, el code queda invalidado para
   * siempre. Tira `TwoFaCodeInvalidError` si no matchea o ya fue usado.
   *
   * NOTA: el code se consume en el mismo statement (UPDATE WHERE used_at
   * IS NULL ... RETURNING). Race-safe: dos requests concurrentes con el
   * mismo code → solo una pasa, la otra tira invalid.
   */
  async verifyAndConsumeRecoveryCode(
    db: TenantDb,
    userId: string,
    code: string,
  ): Promise<void> {
    const user = await this.loadUserOrThrow(db, userId);
    if (!user.twoFaSecret || !user.twoFaEnabled) {
      // Si el user no tiene 2FA activo, no tiene sentido que mande recovery.
      throw new TwoFaCodeInvalidError();
    }
    const ok = await this.recoveryCodes.verifyAndConsume(db, userId, code);
    if (!ok) throw new TwoFaCodeInvalidError();
  }

  /** Cantidad de recovery codes vigentes (no usados) del user. */
  async countActiveRecoveryCodes(db: TenantDb, userId: string): Promise<number> {
    return this.recoveryCodes.countActive(db, userId);
  }

  /**
   * True si al user hay que EXIGIRLE 2FA.
   *
   * Con la policy desactivada (default desde 2026-08-27) devuelve siempre
   * false, aunque el user tenga `two_fa_enabled` en la DB. Los tres llamadores
   * son puntos de enforcement —cambio de password, operaciones sensibles de
   * usuarios y operaciones de wallet—, así que apagarlo acá cubre a los tres
   * sin repetir el chequeo en cada uno.
   *
   * No se toca el dato en la DB: al reactivar la policy, quien tenía 2FA lo
   * vuelve a tener.
   */
  async isEnabled(db: TenantDb, userId: string): Promise<boolean> {
    if (!this.twoFaPolicy.isEnabled()) return false;
    const rows = await db
      .select({ enabled: users.twoFaEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.enabled ?? false;
  }

  private async loadUserOrThrow(db: TenantDb, userId: string): Promise<User> {
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!rows[0]) throw new Error(`User ${userId} no existe.`);
    return rows[0];
  }
}
