import { Global, Module } from '@nestjs/common';
import { ScopeGuard } from './scope.guard';
import { UserHierarchyController } from './user-hierarchy.controller';
import { UserHierarchyService } from './user-hierarchy.service';

/**
 * UserHierarchyModule — @Global porque `ScopeGuard` y `UserHierarchyService`
 * se usan desde múltiples módulos (wallet, deposits, withdrawals, users).
 * Importar a mano sería boilerplate y propenso a errores.
 */
@Global()
@Module({
  controllers: [UserHierarchyController],
  providers: [UserHierarchyService, ScopeGuard],
  exports: [UserHierarchyService, ScopeGuard],
})
export class UserHierarchyModule {}
