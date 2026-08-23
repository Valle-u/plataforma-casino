import { Module } from '@nestjs/common';
import { TenantAuthModule } from '../tenant-auth/tenant-auth.module';
import { PartnerBrandingController } from './partner-branding.controller';
import { PartnerBrandingService } from './partner-branding.service';

/**
 * PartnerBrandingModule — diseño propio de socios independientes (Etapa 1).
 *
 * Importa TenantAuthModule por el JwtService (para verificar el token opcional
 * del visitante en la resolución). UserHierarchyService es @Global. El service
 * se exporta porque `/tenant/info` lo usa para resolver el diseño del socio.
 */
@Module({
  imports: [TenantAuthModule],
  controllers: [PartnerBrandingController],
  providers: [PartnerBrandingService],
  exports: [PartnerBrandingService],
})
export class PartnerBrandingModule {}
