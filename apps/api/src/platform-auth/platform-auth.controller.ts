/**
 * PlatformAuthController — endpoints de auth para super-admins.
 *
 * MVP:
 *   POST /platform/auth/login  — recibe email + password, devuelve JWT.
 *
 * Próximas sesiones:
 *   POST /platform/auth/refresh  — renueva access usando refresh token.
 *   POST /platform/auth/logout   — invalida sesión.
 *   POST /platform/auth/2fa/...  — flujos TOTP.
 */

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { PlatformAuthService, type LoginResult } from './platform-auth.service';

@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly authService: PlatformAuthService) {}

  /**
   * POST /platform/auth/login
   *
   * Body: { email, password }
   * Response 200:
   *   { accessToken: '...', user: { id, email, displayName } }
   * Response 401:
   *   { statusCode: 401, message: 'Credenciales inválidas', error: 'Unauthorized' }
   * Response 400:
   *   { statusCode: 400, message: ['email no válido', ...], error: 'Bad Request' }
   *
   * El cliente guarda accessToken (memoria/sessionStorage) y lo manda en
   *   Authorization: Bearer <accessToken>
   * en cada request siguiente.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.authService.login(dto.email, dto.password);
  }
}
