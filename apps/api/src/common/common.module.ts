/**
 * CommonModule — helpers transversales sin estado de dominio.
 *
 * `@Global` para que cualquier módulo pueda inyectar sin re-importar.
 * Hoy solo exporta `ActorRoleService` (Sprint 51.2) para clasificar
 * actores en flujos de bonuses/promotions/leagues.
 */

import { Global, Module } from '@nestjs/common';
import { ActorRoleService } from './actor-role.service';

@Global()
@Module({
  providers: [ActorRoleService],
  exports: [ActorRoleService],
})
export class CommonModule {}
