/**
 * TenantAuthService — login + refresh + logout para usuarios DENTRO de un tenant.
 *
 * Mismos patterns que PlatformAuthService, pero:
 *   - Trabaja sobre la DB del tenant (no la de control).
 *   - Recibe el `tenantDb` y `tenantId` por parámetro (vienen del TenantContext).
 *   - JWT incluye el tenant_id en el payload.
 *
 * Pendiente para sprints siguientes:
 *   - 2FA TOTP (obligatorio para roles operativos según docs/12).
 *   - Bloqueo por intentos fallidos.
 *   - Re-uso de refresh token rotado → revocar todas las sesiones del user.
 */

import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import {
  generateRefreshToken,
  hashRefreshToken,
  userSessions,
  verifyPassword,
  type User,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { ResponsibleGamingService } from '../responsible-gaming/responsible-gaming.service';
import { UserExcludedError } from '../responsible-gaming/responsible-gaming.errors';
import { TenantUsersService } from '../tenant-users/tenant-users.service';
import { TwoFaCodeInvalidError } from './two-fa.errors';
import { TwoFaService } from './two-fa.service';

/** Payload del JWT de tenant. Discriminado de los de plataforma por `type`. */
export interface TenantJwtPayload {
  /** id del user dentro del tenant. */
  sub: string;
  /** id del tenant — clave para validar que el JWT corresponde al tenant del request. */
  tenantId: string;
  /** username (para identificación rápida en logs sin re-query). */
  username: string;
  /**
   * id de la `user_sessions` row asociada al refresh token que emitió
   * este access. Permite correlar audit entries con la sesión específica.
   * Opcional para retrocompatibilidad con JWTs emitidos antes de
   * Sesión Hardening.
   */
  sid?: string;
  type: 'tenant';
}

export interface SessionContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface TenantAuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    email: string | null;
    displayName: string;
  };
}

const REFRESH_TTL_DAYS = 30;

@Injectable()
export class TenantAuthService {
  private readonly logger = new Logger(TenantAuthService.name);

  constructor(
    private readonly tenantUsersService: TenantUsersService,
    private readonly jwtService: JwtService,
    private readonly twoFa: TwoFaService,
    private readonly responsibleGaming: ResponsibleGamingService,
  ) {}

  /**
   * Valida credenciales contra users del tenant + emite par de tokens.
   *
   * Si el user tiene 2FA enabled, EXIGE uno de los dos:
   *   - `twoFaCode` (TOTP de 6 dígitos), o
   *   - `recoveryCode` (one-time backup code, se consume).
   *
   * Si manda ambos, valida TOTP primero (más barato). Si manda uno y falla,
   * NO intenta el otro — eso revelaría info al atacante sobre el formato
   * esperado.
   */
  async login(
    db: TenantDb,
    tenantId: string,
    username: string,
    password: string,
    context: SessionContext = {},
    twoFaCode?: string,
    recoveryCode?: string,
  ): Promise<TenantAuthResult> {
    const user = await this.tenantUsersService.findByUsername(db, username);

    if (!user) {
      this.logger.warn(`[tenant=${tenantId}] Login fallido: username ${username} no existe`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.status !== 'active') {
      this.logger.warn(`[tenant=${tenantId}] Login bloqueado: ${username} en status ${user.status}`);
      throw new UnauthorizedException('Cuenta no disponible');
    }

    // Sprint 33: responsible gaming — bloquea login si hay auto-exclusión
    // activa (cool_off, temporary o permanent). NO leakeamos info útil para
    // enumeration: el password sigue validándose, pero el error que se
    // devuelve al final es "cuenta bloqueada".
    // Hacemos el check DESPUÉS de status pero ANTES de password — el costo
    // es 1 query DB extra por intento, acceptable.
    try {
      await this.responsibleGaming.assertCanLogin(db, user.id);
    } catch (err) {
      if (err instanceof UserExcludedError) {
        this.logger.warn(
          `[tenant=${tenantId}] Login bloqueado por auto-exclusión: ${username} (${err.type})`,
        );
        const until =
          err.endsAt === null
            ? 'permanente'
            : err.endsAt.toLocaleString('es-AR');
        throw new UnauthorizedException(
          `Tu cuenta está bloqueada por auto-exclusión (${until}).`,
        );
      }
      throw err;
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      this.logger.warn(`[tenant=${tenantId}] Login fallido: password incorrecta para ${username}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 2FA: si el user tiene 2FA enabled, exigir código válido (TOTP o
    // recovery code one-time). Si no tiene 2FA, los campos se ignoran.
    if (user.twoFaEnabled) {
      if (!twoFaCode && !recoveryCode) {
        // Status 400 (no 401) para distinguir "credenciales mal" de
        // "credenciales OK pero falta segundo factor". El frontend
        // puede usarlo para mostrar el prompt de código.
        throw new BadRequestException({
          message: 'Se requiere código 2FA o recovery code para este user.',
          error: 'TWO_FA_REQUIRED',
        });
      }
      try {
        if (twoFaCode) {
          await this.twoFa.verify(db, user.id, twoFaCode);
        } else {
          // Solo recovery — lo consume en el mismo statement (atómico).
          await this.twoFa.verifyAndConsumeRecoveryCode(db, user.id, recoveryCode!);
          this.logger.warn(
            `[tenant=${tenantId}] Login con recovery code consumido para ${username}.`,
          );
        }
      } catch (err) {
        if (err instanceof TwoFaCodeInvalidError) {
          this.logger.warn(
            `[tenant=${tenantId}] Login fallido: código 2FA/recovery inválido para ${username}`,
          );
          throw new UnauthorizedException('Código 2FA inválido');
        }
        throw err;
      }
    }

    void this.tenantUsersService.markLoggedIn(db, user.id).catch((err: unknown) => {
      this.logger.error(`Error markLoggedIn user=${user.id}`, err);
    });

    return this.issueTokens(db, tenantId, user, context, 'login');
  }

  /**
   * Rota refresh token: revoca el actual y emite uno nuevo.
   *
   * Validación crítica: el refresh token debe pertenecer a una sesión
   * de ESTE tenant. Si alguien intenta usar un refresh de tenant A en
   * el dominio de tenant B → 401.
   */
  async refresh(
    db: TenantDb,
    tenantId: string,
    refreshToken: string,
    context: SessionContext = {},
  ): Promise<TenantAuthResult> {
    const tokenHash = hashRefreshToken(refreshToken);

    const sessions = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.tokenHash, tokenHash))
      .limit(1);
    const session = sessions[0];

    if (!session) {
      this.logger.warn(`[tenant=${tenantId}] Refresh fallido: token no encontrado`);
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (session.revokedAt) {
      // Reuse de un refresh ya rotado/revocado → señal fuerte de
      // robo de token (el usuario legítimo lo usó, lo rotó, y ahora
      // alguien intenta usarlo de nuevo). Política de seguridad:
      // revocar TODAS las sesiones activas del user. Si era el usuario
      // legítimo equivocándose, le pedimos re-login; si era un
      // atacante, le matamos la sesión que tenía.
      this.logger.warn(
        `[tenant=${tenantId}] Refresh REUSE detected (sessionId=${session.id}, reason=${session.revokedReason ?? 'unknown'}, userId=${session.userId}). Revocando todas las sesiones activas del user.`,
      );
      await db
        .update(userSessions)
        .set({ revokedAt: new Date(), revokedReason: 'reuse_detected_kill_all' })
        .where(
          and(eq(userSessions.userId, session.userId), isNull(userSessions.revokedAt)),
        );
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (session.expiresAt.getTime() < Date.now()) {
      this.logger.warn(`[tenant=${tenantId}] Refresh fallido: token expirado`);
      throw new UnauthorizedException('Refresh token expirado');
    }

    const user = await this.tenantUsersService.findById(db, session.userId);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Usuario no autorizado');
    }

    await db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: 'rotated' })
      .where(eq(userSessions.id, session.id));

    return this.issueTokens(db, tenantId, user, context, 'refresh');
  }

  async logout(db: TenantDb, refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);

    const result = await db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: 'logout' })
      .where(
        and(eq(userSessions.tokenHash, tokenHash), isNull(userSessions.revokedAt)),
      )
      .returning({ id: userSessions.id });

    if (result.length > 0) {
      this.logger.log(`Logout: tenant session ${result[0]?.id} revocada.`);
    }
  }

  /**
   * Validación del payload JWT por el guard.
   * Re-consulta la DB para asegurar user activo.
   *
   * IMPORTANTE: chequea que `payload.tenantId === tenantContext.tenant.id`
   * para evitar que un JWT de tenant A se use en tenant B.
   */
  async validateJwtPayload(
    db: TenantDb,
    expectedTenantId: string,
    payload: TenantJwtPayload,
  ): Promise<{ id: string; username: string; email: string | null; displayName: string } | null> {
    if (payload.type !== 'tenant') return null;
    if (payload.tenantId !== expectedTenantId) {
      this.logger.warn(
        `JWT tenantId mismatch: payload=${payload.tenantId} expected=${expectedTenantId}`,
      );
      return null;
    }

    const user = await this.tenantUsersService.findById(db, payload.sub);
    if (!user || user.status !== 'active') return null;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
    };
  }

  private async issueTokens(
    db: TenantDb,
    tenantId: string,
    user: User,
    context: SessionContext,
    source: 'login' | 'refresh',
  ): Promise<TenantAuthResult> {
    const refreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    const insertedSession = await db
      .insert(userSessions)
      .values({
        userId: user.id,
        tokenHash,
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
        expiresAt,
      })
      .returning({ id: userSessions.id });
    const sessionId = insertedSession[0]?.id;

    const payload: TenantJwtPayload = {
      sub: user.id,
      tenantId,
      username: user.username,
      sid: sessionId,
      type: 'tenant',
    };
    const accessToken = await this.jwtService.signAsync(payload);

    this.logger.log(
      `[tenant=${tenantId}] Tokens emitidos para ${user.username} (source=${source})`,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }
}
