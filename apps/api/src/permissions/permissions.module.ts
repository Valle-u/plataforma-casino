import { Global, Module } from '@nestjs/common';
import { EffectivePermissionsService } from './effective-permissions.service';
import { PermissionsGuard } from './permissions.guard';

/**
 * PermissionsModule — provee el cálculo de permisos efectivos + guard.
 *
 * @Global porque cualquier módulo que tenga endpoints protegidos por
 * @RequirePermissions necesita poder usarlos sin re-importar.
 */
@Global()
@Module({
  providers: [EffectivePermissionsService, PermissionsGuard],
  exports: [EffectivePermissionsService, PermissionsGuard],
})
export class PermissionsModule {}
