import { Module } from '@nestjs/common';
import { TenantUsersController } from './tenant-users.controller';
import { TenantUsersService } from './tenant-users.service';

/**
 * Notar: NO importamos TenantAuthModule aunque el controller use TenantJwtGuard.
 * TenantAuthModule está marcado @Global, así que el guard está disponible
 * sin necesidad de re-importarlo. Esto evita una dependencia circular
 * (TenantAuthModule importa TenantUsersModule para usar TenantUsersService).
 */
@Module({
  controllers: [TenantUsersController],
  providers: [TenantUsersService],
  exports: [TenantUsersService],
})
export class TenantUsersModule {}
