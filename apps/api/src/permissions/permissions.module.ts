import { Global, Module } from '@nestjs/common';
import { EffectivePermissionsService } from './effective-permissions.service';
import { PermissionOverridesController } from './permission-overrides.controller';
import { PermissionsGuard } from './permissions.guard';

/**
 * PermissionsModule — cálculo de permisos efectivos + guard +
 * endpoints para gestionar overrides individuales.
 *
 * @Global porque cualquier módulo con endpoints protegidos por
 * @RequirePermissions necesita poder usarlos sin re-importar.
 */
@Global()
@Module({
  controllers: [PermissionOverridesController],
  providers: [EffectivePermissionsService, PermissionsGuard],
  exports: [EffectivePermissionsService, PermissionsGuard],
})
export class PermissionsModule {}
