import { Global, Module } from '@nestjs/common';
import { EffectivePermissionsService } from './effective-permissions.service';
import { PermissionOverridesController } from './permission-overrides.controller';
import { PermissionOverridesService } from './permission-overrides.service';
import { PermissionsGuard } from './permissions.guard';

/**
 * PermissionsModule — cálculo de permisos efectivos + guard +
 * endpoints para gestionar overrides individuales.
 *
 * @Global porque cualquier módulo con endpoints protegidos por
 * @RequirePermissions necesita poder usarlos sin re-importar.
 *
 * Sprint 51.5: `PermissionOverridesService` también se exporta para
 * que `TenantUsersController.create` pueda otorgar permisos en bloque
 * al crear un empleado.
 */
@Global()
@Module({
  controllers: [PermissionOverridesController],
  providers: [
    EffectivePermissionsService,
    PermissionsGuard,
    PermissionOverridesService,
  ],
  exports: [
    EffectivePermissionsService,
    PermissionsGuard,
    PermissionOverridesService,
  ],
})
export class PermissionsModule {}
