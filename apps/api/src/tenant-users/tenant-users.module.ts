import { Global, Module } from '@nestjs/common';
import { TenantUsersController } from './tenant-users.controller';
import { TenantUsersService } from './tenant-users.service';

/**
 * Notar: NO importamos TenantAuthModule aunque el controller use TenantJwtGuard.
 * TenantAuthModule está marcado @Global, así que el guard está disponible
 * sin necesidad de re-importarlo. Esto evita una dependencia circular
 * (TenantAuthModule importa TenantUsersModule para usar TenantUsersService).
 *
 * Sprint 43 (security): marcamos este módulo como @Global porque el
 * TenantJwtGuard ahora inyecta TenantUsersService para validar
 * @PanelOnly endpoints. Sin Global, cada módulo que use el guard via
 * @UseGuards tendría que importar TenantUsersModule explícitamente
 * (frágil — si alguien olvida el import en un controller nuevo,
 * runtime crash con DI error opaco).
 */
@Global()
@Module({
  controllers: [TenantUsersController],
  providers: [TenantUsersService],
  exports: [TenantUsersService],
})
export class TenantUsersModule {}
