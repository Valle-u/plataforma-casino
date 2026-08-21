import { Module } from '@nestjs/common';
import { PartnerBrandingController } from './partner-branding.controller';
import { PartnerBrandingService } from './partner-branding.service';

/**
 * PartnerBrandingModule — diseño propio de socios independientes (Etapa 1).
 * El service se exporta porque el endpoint público del player (`/tenant/info`)
 * lo va a usar para resolver el diseño del socio de un jugador.
 */
@Module({
  controllers: [PartnerBrandingController],
  providers: [PartnerBrandingService],
  exports: [PartnerBrandingService],
})
export class PartnerBrandingModule {}
