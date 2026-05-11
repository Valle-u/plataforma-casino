/**
 * @RequirePermissions(...codes) — decorator para marcar qué permisos exige
 * un endpoint o controller.
 *
 * Uso:
 *   @RequirePermissions('users.view_any')
 *   @Get()
 *   listUsers() { ... }
 *
 *   @RequirePermissions('wallet.load', 'wallet.view_any')
 *   @Post('load')
 *   loadChips() { ... }   // requiere AMBOS permisos
 *
 * El PermissionsGuard lee este metadata y valida.
 *
 * Si NO se decora, el guard pasa libre (no requiere permiso específico,
 * pero igual el JWT tiene que ser válido — eso lo enforce TenantJwtGuard).
 */

import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
