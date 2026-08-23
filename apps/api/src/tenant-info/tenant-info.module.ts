import { Module } from '@nestjs/common';
import { PartnerBrandingModule } from '../partner-branding/partner-branding.module';
import { TenantInfoController } from './tenant-info.controller';

@Module({
  // PartnerBrandingModule expone el service que resuelve el diseño del socio
  // del visitante (para /tenant/info).
  imports: [PartnerBrandingModule],
  controllers: [TenantInfoController],
})
export class TenantInfoModule {}
