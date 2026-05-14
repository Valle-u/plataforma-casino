/**
 * NotificationsModule — sistema de notificaciones MVP.
 *
 * @Global porque BonusesAutoGrantService (y futuros hooks en fraud,
 * deposits, withdrawals) van a inyectar NotificationsService. Evita
 * tener que importar el módulo en cada consumidor.
 *
 * Provider de email: ConsoleEmailProvider (logueo). Cuando se sume
 * SMTP/SES, se cambia el `useClass` del provider sin tocar callers.
 *
 * SMS: el dispatcher acepta channel='sms' pero hoy siempre devuelve
 * failed con error 'sms_provider_not_implemented'. Sprint futuro
 * agrega un provider análogo a EmailProvider para Twilio/etc.
 */

import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsDispatcherCron } from './notifications-dispatcher.cron';
import { NotificationsService } from './notifications.service';
import { ConsoleEmailProvider } from './providers/console-email.provider';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsDispatcherCron,
    {
      provide: EMAIL_PROVIDER,
      useClass: ConsoleEmailProvider,
    },
  ],
  exports: [NotificationsService, NotificationsDispatcherCron],
})
export class NotificationsModule {}
