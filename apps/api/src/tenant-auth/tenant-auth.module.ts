/**
 * TenantAuthModule — auth para usuarios DENTRO de un tenant.
 *
 * Reusa la misma JwtModule config que platform-auth (mismo secret + TTL),
 * pero los payloads tienen `type: 'tenant'` para diferenciarlos.
 */

import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PromotionsModule } from '../promotions/promotions.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { TenantUsersModule } from '../tenant-users/tenant-users.module';
import { UserHierarchyModule } from '../user-hierarchy/user-hierarchy.module';
import { TenantAuthController } from './tenant-auth.controller';
import { TenantAuthService } from './tenant-auth.service';
import { TwoFaService } from './two-fa.service';
import { TwoFaPolicyService } from './two-fa-policy.service';
import { RecoveryCodesService } from './recovery-codes.service';
import { TenantJwtGuard } from './guards/tenant-jwt.guard';

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

@Global()
@Module({
  imports: [
    TenantUsersModule,
    ReferralsModule,
    UserHierarchyModule,
    // PromotionsModule provee LoginStreakService que el controller usa
    // post-login para auto-claim. `forwardRef` no debería ser necesario
    // (PromotionsModule no depende de TenantAuthModule), pero lo dejamos
    // listo si en el futuro alguien agrega un endpoint en promotions que
    // necesite TenantJwtGuard directamente (sería import circular).
    forwardRef(() => PromotionsModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_ACCESS_SECRET');
        if (!secret || secret === 'change-me-soon') {
          throw new Error(
            'JWT_ACCESS_SECRET no configurado o tiene el placeholder. Editá .env.local.',
          );
        }
        return {
          secret,
          signOptions: {
            expiresIn: parseTtlToSeconds(
              config.get<string>('JWT_ACCESS_TTL'),
              60 * 60,
            ),
            issuer: 'plataforma-casino-tenant',
          },
        };
      },
    }),
  ],
  controllers: [TenantAuthController],
  providers: [
    TenantAuthService,
    TwoFaService,
    TwoFaPolicyService,
    RecoveryCodesService,
    TenantJwtGuard,
  ],
  exports: [
    TenantAuthService,
    TwoFaService,
    TwoFaPolicyService,
    RecoveryCodesService,
    TenantJwtGuard,
    JwtModule,
  ],
})
export class TenantAuthModule {}
