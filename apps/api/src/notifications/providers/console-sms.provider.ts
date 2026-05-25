/**
 * ConsoleSmsProvider — default no-op para dev / tests / MVP sin Twilio.
 *
 * Loguea con prefijo `[SMS]` para que sea facil grep en logs. Sin envío
 * real. Es el provider que recibe el dispatcher cuando `TWILIO_*` env
 * vars no están configuradas.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider } from './sms-provider.interface';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('ConsoleSmsProvider');

  send(msg: SmsMessage): Promise<void> {
    this.logger.log(
      `[SMS] to=${msg.to} tenant=${msg.tenantSlug ?? 'unknown'} ` +
        `body="${msg.body.slice(0, 80)}${msg.body.length > 80 ? '...' : ''}"`,
    );
    return Promise.resolve();
  }
}
