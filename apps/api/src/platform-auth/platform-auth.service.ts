/**
 * PlatformAuthService — lógica de autenticación para super-admins.
 *
 * Responsabilidades en MVP:
 *   - login(email, password) → access token JWT.
 *   - validatePayload(payload) → user actual (usado por el guard).
 *
 * Pendiente para próximas sesiones (ver docs/12-seguridad-compliance.md):
 *   - refresh tokens con rotación + tabla de sesiones.
 *   - 2FA TOTP (obligatorio para super-admin).
 *   - bloqueo por intentos fallidos.
 *   - alertas de login (impossible travel, device nuevo).
 */

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyPassword } from '@casino/db';
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

export interface LoginResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
}

@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly platformUsersService: PlatformUsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Valida credenciales y emite un access token JWT.
   *
   * Importante: el mensaje de error es genérico ("Credenciales inválidas") tanto
   * si el email no existe como si la password es incorrecta. Evita filtrar al
   * atacante qué emails están registrados (timing + msg attacks).
   */
  async login(email: string, password: string): Promise<LoginResult> {
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

    // Marcar último login (no bloqueante — si falla, el login igual procede).
    void this.platformUsersService.markLoggedIn(user.id).catch((err: unknown) => {
      this.logger.error(`Error al marcar last_login_at para ${user.id}`, err);
    });

    const payload: PlatformJwtPayload = {
      sub: user.id,
      email: user.email,
      type: 'platform',
    };

    const accessToken = await this.jwtService.signAsync(payload);

    this.logger.log(`Login exitoso: ${user.email} (id=${user.id})`);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }

  /**
   * Usado por el guard JWT: valida el payload y devuelve el usuario actual.
   * Re-consulta la DB para asegurar que el usuario sigue existiendo y está activo.
   * (Si lo banneamos mid-session, el siguiente request rechaza.)
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
}
