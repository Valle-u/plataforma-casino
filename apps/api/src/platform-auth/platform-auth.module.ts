/**
 * PlatformAuthModule — auth para super-admins.
 *
 * Configura JwtModule de forma async para leer secret + ttl desde ConfigService
 * (que vino de .env.local).
 *
 * Exporta PlatformJwtGuard y PlatformAuthService para que otros módulos
 * (como TenantsModule) puedan proteger sus endpoints.
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PlatformUsersModule } from '../platform-users/platform-users.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformJwtGuard } from './guards/platform-jwt.guard';

/**
 * Convierte un TTL tipo "15m" / "1h" / "30d" a segundos.
 * Devuelve fallback si el formato es inválido.
 * Pasamos a número porque el tipado de JwtModule (vía paquete `ms`) acepta
 * `number | StringValue` y un `string` genérico no le cuadra.
 */
function parseTtlToSeconds(raw: string | undefined, fallbackSeconds: number): number {
  if (!raw) return fallbackSeconds;
  const match = raw.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return fallbackSeconds;
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      return fallbackSeconds;
  }
}

@Module({
  imports: [
    PlatformUsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_ACCESS_SECRET');
        if (!secret || secret === 'change-me-soon') {
          throw new Error(
            'JWT_ACCESS_SECRET no configurado o tiene el placeholder. ' +
              'Editá apps/api/.env.local y poné un secret real (random largo).',
          );
        }
        const expiresInSeconds = parseTtlToSeconds(
          config.get<string>('JWT_ACCESS_TTL'),
          15 * 60, // 15 min default
        );
        return {
          secret,
          signOptions: {
            expiresIn: expiresInSeconds,
            issuer: 'plataforma-casino',
          },
        };
      },
    }),
  ],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService, PlatformJwtGuard],
  exports: [PlatformAuthService, PlatformJwtGuard, JwtModule],
})
export class PlatformAuthModule {}
