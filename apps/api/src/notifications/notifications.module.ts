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
 *
 * Web Push (Fase 3): el dispatcher acepta channel='web_push'. El
 * provider se elige por factory: si VAPID keys están seteadas →
 * WebPushProvider (envío real); sino → ConsolePushProvider (logueo).
 */

import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationTemplatesController } from './notification-templates.controller';
import { NotificationTemplatesService } from './notification-templates.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsDispatcherCron } from './notifications-dispatcher.cron';
import { NotificationsService } from './notifications.service';
import { PushSubscriptionsController } from './push-subscriptions.controller';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { ConsoleEmailProvider } from './providers/console-email.provider';
import { ConsolePushProvider } from './providers/console-push.provider';
import { ConsoleSmsProvider } from './providers/console-sms.provider';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { PUSH_PROVIDER, type PushProvider } from './providers/push-provider.interface';
import { SMS_PROVIDER, type SmsProvider } from './providers/sms-provider.interface';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';
import { WebPushProvider } from './providers/web-push.provider';

/**
 * Factory del SMS provider:
 *   - Si las 3 env vars de Twilio están seteadas → TwilioSmsProvider.
 *   - Sino → ConsoleSmsProvider (loguea, no envía nada).
 *
 * `TWILIO_API_BASE_URL` (opcional) override para tests apuntando a mock.
 */
function smsProviderFactory(config: ConfigService): SmsProvider {
  const logger = new Logger('NotificationsModule:smsProviderFactory');
  const sid = config.get<string>('TWILIO_ACCOUNT_SID');
  const token = config.get<string>('TWILIO_AUTH_TOKEN');
  const from = config.get<string>('TWILIO_FROM_NUMBER');
  if (sid && token && from) {
    logger.log(
      `Twilio SMS provider habilitado (from=${from}, sid=${sid.slice(0, 6)}...).`,
    );
    return new TwilioSmsProvider({
      accountSid: sid,
      authToken: token,
      fromNumber: from,
      apiBaseUrl: config.get<string>('TWILIO_API_BASE_URL'),
    });
  }
  logger.log('Twilio NO configurado — usando ConsoleSmsProvider (logueo).');
  return new ConsoleSmsProvider();
}

/**
 * Factory del Push provider:
 *   - Si VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT están
 *     seteadas → WebPushProvider (envío real).
 *   - Sino → ConsolePushProvider (loguea, no envía nada).
 */
function pushProviderFactory(config: ConfigService): PushProvider {
  const logger = new Logger('NotificationsModule:pushProviderFactory');
  const publicKey = config.get<string>('VAPID_PUBLIC_KEY');
  const privateKey = config.get<string>('VAPID_PRIVATE_KEY');
  const subject = config.get<string>('VAPID_SUBJECT');
  if (publicKey && privateKey && subject) {
    return new WebPushProvider({
      vapidPublicKey: publicKey,
      vapidPrivateKey: privateKey,
      vapidSubject: subject,
    });
  }
  logger.log('VAPID NO configurado — usando ConsolePushProvider (logueo).');
  return new ConsolePushProvider();
}

@Global()
@Module({
  controllers: [
    NotificationsController,
    NotificationTemplatesController,
    PushSubscriptionsController,
  ],
  providers: [
    NotificationsService,
    NotificationsDispatcherCron,
    NotificationTemplatesService,
    PushSubscriptionsService,
    {
      provide: EMAIL_PROVIDER,
      useClass: ConsoleEmailProvider,
    },
    {
      provide: SMS_PROVIDER,
      useFactory: smsProviderFactory,
      inject: [ConfigService],
    },
    {
      provide: PUSH_PROVIDER,
      useFactory: pushProviderFactory,
      inject: [ConfigService],
    },
  ],
  exports: [
    NotificationsService,
    NotificationsDispatcherCron,
    NotificationTemplatesService,
    PushSubscriptionsService,
  ],
})
export class NotificationsModule {}
