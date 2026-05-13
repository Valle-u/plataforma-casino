/**
 * RecoveryCodesService — backup one-time codes para 2FA TOTP.
 *
 * Flujo:
 *   1. Al `confirmSetup` de 2FA, generamos 10 codes random de alta entropía.
 *      Plain text se devuelve al user UNA SOLA VEZ — el server solo persiste
 *      el SHA-256 hash.
 *   2. En login, si el user tiene 2FA enabled y manda `recoveryCode` en
 *      lugar de `twoFaCode`, hasheamos y buscamos coincidencia con codes
 *      no consumidos. Si OK, marcamos `used_at = NOW()`.
 *   3. El user puede `regenerate-recovery-codes` (requiere TOTP fresco).
 *      Esto invalida los viejos (no se borran — auditoría).
 *
 * Codes:
 *   - Formato `xxxx-xxxx-xx` (10 chars hex, agrupados con guiones para
 *     facilitar la transcripción manual del backup que el user imprime).
 *   - 40 bits de entropía — suficiente para resistir guessing online; el
 *     rate limit del endpoint (sprint próximo) cierra el resto.
 *
 * Hash:
 *   - SHA-256. Es OK aquí porque el code tiene 40 bits de entropía,
 *     NO es una password humana. Para passwords usamos argon2; acá no
 *     hace falta el costo.
 *   - Constant-time comparison: no comparamos strings de hashes
 *     directamente sino que hacemos lookup por hash, que es naturalmente
 *     constant-time desde el lado del DB.
 *
 * IMPORTANTE: `verifyAndConsume` corre en una transacción con `FOR UPDATE`
 * sobre la fila del recovery code — si dos requests concurrentes intentan
 * usar el mismo code, uno gana y el otro ve `used_at != null` y rechaza.
 */

import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { userRecoveryCodes } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

/** Cuántos codes generamos al setup. */
const CODES_PER_BATCH = 10;

/** Bytes random por code. 5 bytes = 40 bits, expresados como 10 hex chars. */
const RANDOM_BYTES_PER_CODE = 5;

export interface GenerateResult {
  /**
   * Plain codes para mostrar al user UNA vez. Formato `xxxx-xxxx-xx` para
   * facilitar transcripción visual.
   */
  codes: string[];
}

@Injectable()
export class RecoveryCodesService {
  /**
   * Genera N codes nuevos para el user. Si ya tenía codes vigentes, los
   * INVALIDA (los marca como used — no se borra historia para auditoría).
   * Devuelve plain text para mostrar al user una sola vez.
   *
   * Se llama desde `confirmSetup` (primer setup) y desde
   * `regenerateRecoveryCodes` (cuando el user pide rotar).
   */
  async generateForUser(db: TenantDb, userId: string): Promise<GenerateResult> {
    // 1. Invalidar codes anteriores no consumidos. Marcamos used_at con
    //    NOW() para que queden trazables como "invalidados por regeneración"
    //    sin necesitar columna extra (reason se infiere por el patrón).
    await db
      .update(userRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));

    // 2. Generar y persistir los nuevos. Hasheamos SIEMPRE la forma
    //    normalizada (sin guiones, lowercase) para que el verify acepte
    //    tanto "abcd-1234-ef" como "abcd1234ef".
    const plainCodes: string[] = [];
    const inserts: { userId: string; codeHash: string }[] = [];
    for (let i = 0; i < CODES_PER_BATCH; i += 1) {
      const plain = this.makeCode();
      plainCodes.push(plain);
      inserts.push({ userId, codeHash: this.hash(this.normalize(plain)) });
    }
    await db.insert(userRecoveryCodes).values(inserts);

    return { codes: plainCodes };
  }

  /**
   * Verifica un code y lo consume si es válido. Retorna true si el code
   * matcheó un row no usado del user. Una vez consumido, no se puede
   * volver a usar.
   *
   * Diseño anti-race: usamos un UPDATE con WHERE used_at IS NULL y
   * RETURNING. Postgres garantiza atomicidad — si dos requests llegan a
   * la vez con el mismo code, solo uno verá filas afectadas.
   */
  async verifyAndConsume(
    db: TenantDb,
    userId: string,
    plainCode: string,
  ): Promise<boolean> {
    // Sanitizar el input antes de hashear: aceptamos el formato con o sin
    // guiones (el user puede tipear "abcd-1234-ef" o "abcd1234ef").
    const normalized = this.normalize(plainCode);
    if (!this.isValidShape(normalized)) return false;

    const expectedHash = this.hash(normalized);

    const updated = await db
      .update(userRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(userRecoveryCodes.userId, userId),
          eq(userRecoveryCodes.codeHash, expectedHash),
          isNull(userRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: userRecoveryCodes.id });

    return updated.length > 0;
  }

  /** Cantidad de codes vigentes (no consumidos) del user. */
  async countActive(db: TenantDb, userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userRecoveryCodes)
      .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
    return result[0]?.count ?? 0;
  }

  /**
   * Borra TODOS los codes (usados y no) del user. Se llama desde
   * `TwoFaService.disable` — si el user apaga 2FA, los recovery codes
   * dejan de tener sentido.
   */
  async deleteAllForUser(db: TenantDb, userId: string): Promise<void> {
    await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Genera un code en formato `xxxx-xxxx-xx` (10 hex chars en 3 grupos).
   * 40 bits de entropía — suficiente para resistir guessing online cuando
   * combinado con rate limit por user.
   */
  private makeCode(): string {
    const hex = randomBytes(RANDOM_BYTES_PER_CODE).toString('hex'); // 10 chars
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 10)}`;
  }

  /** SHA-256 hex del code. */
  private hash(plainCode: string): string {
    return createHash('sha256').update(plainCode).digest('hex');
  }

  /** Acepta input con o sin guiones, case-insensitive. */
  private normalize(input: string): string {
    return input.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  }

  /** 10 chars hex después de normalizar. */
  private isValidShape(normalized: string): boolean {
    return /^[0-9a-f]{10}$/.test(normalized);
  }
}
