import { Global, Module } from '@nestjs/common';
import { ResponsibleGamingController } from './responsible-gaming.controller';
import { ResponsibleGamingService } from './responsible-gaming.service';

/**
 * ResponsibleGamingModule — límites + auto-exclusión.
 *
 * @Global porque otros módulos (deposits, tenant-auth, futuro wallet.bet)
 * inyectan el service para los hooks de enforcement sin reimportar.
 */
@Global()
@Module({
  controllers: [ResponsibleGamingController],
  providers: [ResponsibleGamingService],
  exports: [ResponsibleGamingService],
})
export class ResponsibleGamingModule {}
