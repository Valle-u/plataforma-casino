/**
 * PlatformAuthService — lógica de autenticación para super-admins.
 *
 * Responsabilidades en MVP:
 *   - login(email, password, context) → access token + refresh token.
 *   - refresh(refreshToken, context)  → rotación de refresh + nuevo access.
 *   - logout(refreshToken)            → revoca la sesión.
 *   - validateJwtPayload(payload)     → user actual (usado por el guard).
 *
 * Pendiente para próximas sesiones (ver docs/12-seguridad-compliance.md):
 *   - 2FA TOTP (obligatorio para super-admin).
 *   - Bloqueo por intentos fallidos (rate limit + cuenta lockeada).
 *   - Alertas de login (impossible travel, device nuevo).
 *   - "Cerrar sesión en todos los dispositivos" (revoke all sessions).
 *
 * Diseño de refresh tokens:
 *   - Access JWT (15 min) — stateless, firma verificada en cada request.
 *   - Refresh opaque (30 días) — guardado como SHA-256 hash en DB. Stateful.
 *   - Rotación estricta: cada /refresh consume el actual y emite uno nuevo.
 *     Reusar un refresh ya rotado = 401 (potencial robo).
 */

import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import {
  generateRefreshToken,
  hashRefreshToken,
  platformUserSessions,
  verifyPassword,
  type ControlDb,
  type PlatformUser,
} from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { PlatformUsersService } from '../platform-users/platform-users.service';

/** Payload que va dentro del JWT. Mantenelo chico — todo es público en base64. */
export interface PlatformJwtPayload {
  /** subject: id del platform user. Convención estándar JWT. */
  sub: string;
  /** Email para identificación rápida sin re-query. */
  email: string;
  /** Discriminador para no confundir con tokens de tenant en el futuro. */
  type: 'platform';
}

export interface SessionContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
}

const REFRESH_TTL_DAYS = 30;

@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    @Inject(CONTROL_DB) private readonly db: ControlDb,
    private readonly platformUsersService: PlatformUsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Valida credenciales, crea sesión y emite access + refresh tokens.
   *
   * Mensaje de error genérico ("Credenciales inválidas") para email no existente
   * y password incorrecta — evita filtrar info al atacante.
   */
  async login(email: string, password: string, context: SessionContext = {}): Promise<AuthResult> {
    const user = await this.platformUsersService.findByEmail(email);

    if (!user) {
      this.logger.warn(`Login fallido: email no encontrado (${email})`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.status !== 'active') {
      this.logger.warn(`Login bloqueado: usuario ${email} en status ${user.status}`);
      throw new UnauthorizedException('Cuenta no disponible');
    }

    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (!passwordOk) {
      this.logger.warn(`Login fallido: password incorrecta para ${email}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Marcar último login (no bloqueante).
    void this.platformUsersService.markLoggedIn(user.id).catch((err: unknown) => {
      this.logger.error(`Error al marcar last_login_at para ${user.id}`, err);
    });

    return this.issueTokens(user, context, 'login');
  }

  /**
   * Rota el refresh token: revoca el actual y emite uno nuevo.
   *
   * Si el token recibido no existe, está expirado, o ya fue revocado → 401.
   */
  async refresh(refreshToken: string, context: SessionContext = {}): Promise<AuthResult> {
    const tokenHash = hashRefreshToken(refreshToken);

    const sessions = await this.db
      .select()
      .from(platformUserSessions)
      .where(eq(platformUserSessions.tokenHash, tokenHash))
      .limit(1);
    const session = sessions[0];

    if (!session) {
      this.logger.warn('Refresh fallido: token no encontrado en DB');
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (session.revokedAt) {
      // Posible robo de token: alguien usa un refresh ya rotado.
      // En MVP solo loggeamos. En v2 podríamos revocar todas las sesiones del user.
      this.logger.warn(
        `Refresh fallido: token revocado (sessionId=${session.id}, reason=${session.revokedReason ?? 'unknown'})`,
      );
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (session.expiresAt.getTime() < Date.now()) {
      this.logger.warn(`Refresh fallido: token expirado (sessionId=${session.id})`);
      throw new UnauthorizedException('Refresh token expirado');
    }

    const user = await this.platformUsersService.findById(session.userId);
    if (!user || user.status !== 'active') {
      this.logger.warn(`Refresh fallido: user ${session.userId} no existe o no activo`);
      throw new UnauthorizedException('Usuario no autorizado');
    }

    // Marcar la sesión actual como rotada.
    await this.db
      .update(platformUserSessions)
      .set({ revokedAt: new Date(), revokedReason: 'rotated' })
      .where(eq(platformUserSessions.id, session.id));

    return this.issueTokens(user, context, 'refresh');
  }

  /**
   * Logout: marca la sesión asociada al refresh token como revocada.
   *
   * Idempotente: si el token no existe o ya está revocado, igual devuelve OK
   * (evita filtrar al atacante si un token es válido o no).
   */
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);

    const result = await this.db
      .update(platformUserSessions)
      .set({ revokedAt: new Date(), revokedReason: 'logout' })
      .where(
        and(
          eq(platformUserSessions.tokenHash, tokenHash),
          isNull(platformUserSessions.revokedAt),
        ),
      )
      .returning({ id: platformUserSessions.id });

    if (result.length > 0) {
      this.logger.log(`Logout: sesión ${result[0]?.id} revocada.`);
    }
    // Si no había sesión activa con ese hash, silencio (idempotencia).
  }

  /**
   * Usado por el guard JWT: valida el payload y devuelve el usuario actual.
   * Re-consulta la DB para asegurar que el usuario sigue existiendo y activo.
   */
  async validateJwtPayload(
    payload: PlatformJwtPayload,
  ): Promise<{ id: string; email: string; displayName: string } | null> {
    if (payload.type !== 'platform') return null;

    const user = await this.platformUsersService.findById(payload.sub);
    if (!user || user.status !== 'active') return null;

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------------

  /**
   * Crea una nueva sesión + emite par de tokens (access + refresh).
   * Usado tanto por login como por refresh.
   */
  private async issueTokens(
    user: PlatformUser,
    context: SessionContext,
    source: 'login' | 'refresh',
  ): Promise<AuthResult> {
    const refreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.db.insert(platformUserSessions).values({
      userId: user.id,
      tokenHash,
      userAgent: context.userAgent ?? null,
      ip: context.ip ?? null,
      expiresAt,
    });

    const payload: PlatformJwtPayload = {
      sub: user.id,
      email: user.email,
      type: 'platform',
    };
    const accessToken = await this.jwtService.signAsync(payload);

    this.logger.log(
      `Tokens emitidos para ${user.email} (id=${user.id}, source=${source})`,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }
}
