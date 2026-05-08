/**
 * TenantsModule — agrupa todo lo relacionado a tenants.
 *
 * Importa AdminTokenGuard (con su dep de ConfigService) como provider local
 * porque el guard se usa solo en este módulo. Si en el futuro lo usan otros
 * módulos, lo movemos a un AuthModule compartido.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { AdminTokenGuard } from '../auth/admin-token.guard';

@Module({
  imports: [ConfigModule],
  controllers: [TenantsController],
  providers: [TenantsService, AdminTokenGuard],
})
export class TenantsModule {}
