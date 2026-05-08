/**
 * TenantsModule — agrupa todo lo relacionado a tenants.
 *
 * Importa AdminTokenGuard (con su dep de ConfigService) como provider local
 * porque el guard se usa solo en este módulo. Si en el futuro lo usan otros
 * módulos, lo movemos a un AuthModule compartido.
 */

import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../platform-auth/platform-auth.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  // PlatformAuthModule exporta JwtModule + PlatformJwtGuard + PlatformAuthService.
  // Lo importamos para poder usar el guard en el controller.
  imports: [PlatformAuthModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
